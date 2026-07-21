const prisma = require('../config/prisma');
const { uploadToR2 } = require('../utils/fileUpload');
const { slugify, ensureUniqueSlug } = require('../utils/slugify');
const { redisCache, buildCacheKey } = require('../utils/redisCache');

// Admin-entered JSON-LD schemas. The editor may send a parsed object/array (valid JSON)
// or a raw string (e.g. pasted <script> tags or several objects). Store as text so any
// of those round-trips; the public blog page parses it back into one or more schemas.
const normalizeStructuredData = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') return value.trim() || null;
  try { return JSON.stringify(value); } catch { return null; }
};

const BLOG_TTL = 1800; // 30 minutes — invalidated on every write
const blogSlugKey  = (slug)   => buildCacheKey('blog_slug', slug);
const blogContentKey = (blogId) => buildCacheKey('blog_content', blogId);

const invalidateBlogCache = async (blogId, slug) => {
  const ops = [];
  if (blogId) ops.push(redisCache.del(blogContentKey(blogId)));
  if (slug)   ops.push(redisCache.del(blogSlugKey(slug)));
  await Promise.all(ops);
  console.log(`[Cache] Invalidated blog cache — blogId: ${blogId || 'n/a'}, slug: ${slug || 'n/a'}`);
};

const buildErrorResponse = (res, message, error) => {
  console.error(message, error);
  return res.status(500).json({ error: message });
};

// The public blog pages send `Cache-Control: no-cache` (and a `?_t=` buster) on every
// request specifically to read fresh content right after an admin publishes/edits.
// Honor that here by skipping the Redis READ (we still WRITE fresh cache so normal
// traffic stays fast). Without this, a stale empty-content cache can mask a freshly
// published article ("No content available yet.").
const wantsFreshContent = (req) =>
  /no-cache|no-store/i.test(req.headers['cache-control'] || '') ||
  /no-cache/i.test(req.headers['pragma'] || '');

const VALID_STATUSES = new Set(['draft', 'pending', 'published']);

const normalizeStatus = (candidate, fallback = 'draft') => {
  if (candidate && VALID_STATUSES.has(candidate)) {
    return candidate;
  }
  return fallback;
};

const buildStatusFields = ({ requestedStatus, requestedIsPublished, fallbackStatus = 'draft', currentPublishedAt = null }) => {
  let nextStatus = fallbackStatus;

  if (requestedStatus && VALID_STATUSES.has(requestedStatus)) {
    nextStatus = requestedStatus;
  } else if (typeof requestedIsPublished === 'boolean') {
    nextStatus = requestedIsPublished ? 'published' : 'draft';
  }

  const isPublished = nextStatus === 'published';
  let publishedAt = currentPublishedAt;

  if (isPublished) {
    publishedAt = publishedAt || new Date().toISOString();
  } else {
    publishedAt = null;
  }

  return {
    status: nextStatus,
    is_published: isPublished,
    published_at: publishedAt
  };
};

const blogController = {
  // Get all blogs (public + admin)
  async getBlogs(req, res) {
    try {
      const { page = 1, limit = 12, category, categories, search, featured, published, status } = req.query;
      const offset = (page - 1) * limit;

      const where = {};
      const isPrivileged = req.user && ['admin', 'editor', 'author'].includes(req.user.role);

      // Public users only see published blogs
      if (!isPrivileged) {
        where.is_published = true;
      } else {
        if (published !== undefined) {
          where.is_published = published === 'true';
        }
        if (status && VALID_STATUSES.has(status)) {
          where.status = status;
        }
      }

      if (category) {
        where.category = category;
      }

      if (categories) {
        const categoryList = String(categories)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        if (categoryList.length > 0) {
          where.category = { in: categoryList };
        }
      }

      if (featured === 'true') {
        where.is_featured = true;
      }

      if (search) {
        where.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { excerpt: { contains: search, mode: 'insensitive' } },
        ];
      }

      let data, count;
      try {
        [data, count] = await Promise.all([
          prisma.blogs.findMany({
            where,
            orderBy: [{ published_at: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
            skip: offset,
            take: parseInt(limit),
          }),
          prisma.blogs.count({ where }),
        ]);
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch blogs', error);
      }

      res.json({
        success: true,
        data,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count || 0,
          totalPages: count ? Math.ceil(count / limit) : 0
        }
      });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to fetch blogs', error);
    }
  },

  // Get single blog by slug
  async getBlogBySlug(req, res) {
    try {
      const { slug } = req.params;
      const isPrivileged = req.user && ['admin', 'editor', 'author'].includes(req.user.role);

      // Serve from cache for public requests (unless the caller explicitly asked for fresh data)
      if (!isPrivileged && !wantsFreshContent(req)) {
        const cacheKey = blogSlugKey(slug);
        const cached = await redisCache.get(cacheKey);
        if (cached) {
          console.log(`[Cache] HIT  blog_slug:${slug}`);
          // Still increment view count fire-and-forget
          if (cached.data?.id) {
            prisma.blogs.update({ where: { id: cached.data.id }, data: { view_count: (cached.data?.view_count || 0) + 1 } }).catch(() => {});
          }
          return res.json(cached);
        }
        console.log(`[Cache] MISS blog_slug:${slug} — fetching from DB`);
      }

      const data = await prisma.blogs.findUnique({ where: { slug } });

      if (!data) {
        return res.status(404).json({ error: 'Blog not found' });
      }

      if (!isPrivileged && !data.is_published) {
        return res.status(403).json({ error: 'Blog not published yet' });
      }

      // Increment view count
      await prisma.blogs.update({
        where: { id: data.id },
        data: { view_count: (data.view_count || 0) + 1 },
      });

      // Fetch author separately
      let author = null;
      if (data.author_id) {
        author = await prisma.users.findUnique({
          where: { id: data.author_id },
          select: { id: true, name: true, avatar_url: true, bio: true, role: true },
        });
      }

      const responsePayload = { success: true, data: { ...data, author } };

      // Cache for public published blogs only
      if (!isPrivileged && data.is_published) {
        await redisCache.set(blogSlugKey(slug), responsePayload, BLOG_TTL);
        console.log(`[Cache] SET  blog_slug:${slug} (TTL ${BLOG_TTL}s)`);
      }

      res.json(responsePayload);
    } catch (error) {
      return buildErrorResponse(res, 'Failed to fetch blog', error);
    }
  },

  async getBlogById(req, res) {
    try {
      const { blogId } = req.params;
      if (!req.user || !['admin', 'editor', 'author'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      let data;
      try {
        data = await prisma.blogs.findUnique({ where: { id: blogId } });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch blog', error);
      }

      if (!data) {
        return res.status(404).json({ error: 'Blog not found' });
      }

      res.json({ success: true, data });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to fetch blog', error);
    }
  },

  // Get blog content (sections and blocks)
  async getBlogContent(req, res) {
    try {
      const { blogId } = req.params;
      const isPrivileged = req.user && ['admin', 'editor', 'author'].includes(req.user.role);

      // Serve from cache for public requests (unless the caller explicitly asked for fresh data)
      if (!isPrivileged && !wantsFreshContent(req)) {
        const cacheKey = blogContentKey(blogId);
        const cached = await redisCache.get(cacheKey);
        if (cached) {
          console.log(`[Cache] HIT  blog_content:${blogId}`);
          return res.json(cached);
        }
        console.log(`[Cache] MISS blog_content:${blogId} — fetching from DB`);
      }

      const blog = await prisma.blogs.findUnique({
        where: { id: blogId },
        select: { id: true, status: true, is_published: true },
      });

      if (!blog) {
        return res.status(404).json({ error: 'Blog not found' });
      }

      if (!isPrivileged && !blog.is_published) {
        return res.status(403).json({ error: 'Blog not published yet' });
      }

      let sections;
      try {
        sections = await prisma.blog_sections.findMany({
          where: { blog_id: blogId },
          orderBy: { display_order: 'asc' },
        });
      } catch (sectionsError) {
        return buildErrorResponse(res, 'Failed to fetch blog sections', sectionsError);
      }

      const sectionIds = sections.map(s => s.id);
      let blocks = [];

      if (sectionIds.length > 0) {
        try {
          blocks = await prisma.blog_blocks.findMany({
            where: { section_id: { in: sectionIds } },
            orderBy: { display_order: 'asc' },
          });
        } catch (blocksError) {
          return buildErrorResponse(res, 'Failed to fetch blog blocks', blocksError);
        }
      }

      const sectionsWithBlocks = sections.map(section => ({
        ...section,
        blocks: blocks.filter(block => block.section_id === section.id)
      }));

      const responsePayload = { success: true, sections: sectionsWithBlocks };

      // Cache for public published blogs only
      if (!isPrivileged && blog.is_published) {
        await redisCache.set(blogContentKey(blogId), responsePayload, BLOG_TTL);
        console.log(`[Cache] SET  blog_content:${blogId} (TTL ${BLOG_TTL}s)`);
      }

      res.json(responsePayload);
    } catch (error) {
      return buildErrorResponse(res, 'Failed to fetch blog content', error);
    }
  },

  async getBlogCategories(req, res) {
    try {
      const where = { category: { not: null } };
      if (!req.user || !['admin', 'editor', 'author'].includes(req.user.role)) {
        where.is_published = true;
      }

      let data;
      try {
        data = await prisma.blogs.findMany({ where, select: { category: true } });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch categories', error);
      }

      const categories = Array.from(
        new Set(
          (data || [])
            .map((row) => row.category)
            .filter((value) => typeof value === 'string' && value.trim().length > 0)
        )
      ).sort((a, b) => a.localeCompare(b));

      return res.json({ success: true, data: categories });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to fetch categories', error);
    }
  },

  // Create blog
  async createBlog(req, res) {
    try {
      const {
        title,
        slug: customSlug,
        excerpt,
        featured_image_url,
        category,
        tags,
        is_published,
        is_featured,
        meta_title,
        meta_description,
        meta_keywords,
        og_title,
        og_description,
        og_image_url,
        canonical_url,
        structured_data,
        is_current_affairs_note,
        current_affairs_tag,
        status: requestedStatus
      } = req.body;

      if (!title) {
        return res.status(400).json({ error: 'Title is required' });
      }

      const baseSlug = customSlug || slugify(title);
      const uniqueSlug = await ensureUniqueSlug(prisma.blogs, baseSlug);

      const statusFields = buildStatusFields({
        requestedStatus,
        requestedIsPublished: is_published,
        fallbackStatus: is_published ? 'published' : 'draft'
      });

      const payload = {
        title,
        slug: uniqueSlug,
        excerpt: excerpt || null,
        featured_image_url: featured_image_url || null,
        author_id: req.body.author_id || req.user?.id || null,
        category: category || null,
        tags: tags || [],
        status: statusFields.status,
        is_published: statusFields.is_published,
        is_featured: is_featured || false,
        published_at: statusFields.published_at,
        meta_title: meta_title || null,
        meta_description: meta_description || null,
        meta_keywords: meta_keywords || null,
        og_title: og_title || null,
        og_description: og_description || null,
        og_image_url: og_image_url || null,
        canonical_url: canonical_url || null,
        structured_data: normalizeStructuredData(structured_data) ?? null,
        is_current_affairs_note: Boolean(is_current_affairs_note),
        current_affairs_tag: current_affairs_tag || null,
        created_by: req.user?.id || null,
        updated_by: req.user?.id || null
      };

      let data;
      try {
        data = await prisma.blogs.create({ data: payload });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to create blog', error);
      }

      res.status(201).json({ success: true, data });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to create blog', error);
    }
  },

  // Update blog
  async updateBlog(req, res) {
    try {
      const { blogId } = req.params;
      const {
        title,
        slug: customSlug,
        excerpt,
        featured_image_url,
        category,
        tags,
        is_published,
        is_featured,
        meta_title,
        meta_description,
        meta_keywords,
        og_title,
        og_description,
        og_image_url,
        canonical_url,
        structured_data,
        is_current_affairs_note,
        current_affairs_tag,
        status: requestedStatus
      } = req.body;

      const existingBlog = await prisma.blogs.findUnique({
        where: { id: blogId },
        select: { status: true, published_at: true },
      });

      if (!existingBlog) {
        return buildErrorResponse(res, 'Blog not found', new Error('Blog not found'));
      }

      const payload = {
        updated_by: req.user?.id || null,
        updated_at: new Date().toISOString()
      };

      if (title !== undefined) payload.title = title;
      if (customSlug !== undefined) {
        const uniqueSlug = await ensureUniqueSlug(prisma.blogs, customSlug, { excludeId: blogId });
        payload.slug = uniqueSlug;
      }
      if (excerpt !== undefined) payload.excerpt = excerpt;
      if (featured_image_url !== undefined) payload.featured_image_url = featured_image_url;
      if (category !== undefined) payload.category = category;
      if (tags !== undefined) payload.tags = tags;
      if (is_featured !== undefined) payload.is_featured = is_featured;
      if (meta_title !== undefined) payload.meta_title = meta_title;
      if (meta_description !== undefined) payload.meta_description = meta_description;
      if (meta_keywords !== undefined) payload.meta_keywords = meta_keywords;
      if (og_title !== undefined) payload.og_title = og_title;
      if (og_description !== undefined) payload.og_description = og_description;
      if (og_image_url !== undefined) payload.og_image_url = og_image_url;
      if (canonical_url !== undefined) payload.canonical_url = canonical_url;
      if (structured_data !== undefined) payload.structured_data = normalizeStructuredData(structured_data);
      if (is_current_affairs_note !== undefined) payload.is_current_affairs_note = Boolean(is_current_affairs_note);
      if (current_affairs_tag !== undefined) payload.current_affairs_tag = current_affairs_tag || null;
      if (req.body.author_id !== undefined) payload.author_id = req.body.author_id || null;

      const statusFields = buildStatusFields({
        requestedStatus,
        requestedIsPublished: is_published,
        fallbackStatus: existingBlog?.status || 'draft',
        currentPublishedAt: existingBlog?.published_at || null
      });

      payload.status = statusFields.status;
      payload.is_published = statusFields.is_published;
      payload.published_at = statusFields.published_at;

      let data;
      try {
        data = await prisma.blogs.update({ where: { id: blogId }, data: payload });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to update blog', error);
      }

      // Invalidate both slug and content caches
      await invalidateBlogCache(blogId, data.slug);
      res.json({ success: true, data });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to update blog', error);
    }
  },

  // Delete blog
  async deleteBlog(req, res) {
    try {
      const { blogId } = req.params;

      try {
        await prisma.blogs.delete({ where: { id: blogId } });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to delete blog', error);
      }

      await invalidateBlogCache(blogId, null);
      res.json({ success: true, message: 'Blog deleted successfully' });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to delete blog', error);
    }
  },

  // Bulk sync blog content (sections and blocks)
  async bulkSyncBlogContent(req, res) {
    try {
      const { blogId } = req.params;
      const { sections } = req.body;

      if (!sections || !Array.isArray(sections)) {
        return res.status(400).json({ error: 'Sections array is required' });
      }

      // Fetch existing sections
      const existingSections = await prisma.blog_sections.findMany({
        where: { blog_id: blogId },
        select: { id: true },
      });

      const existingSectionIds = existingSections.map(s => s.id);
      const incomingSectionIds = sections.filter(s => s.id && !s.id.startsWith('temp-')).map(s => s.id);

      // Delete removed sections
      const sectionsToDelete = existingSectionIds.filter(id => !incomingSectionIds.includes(id));
      if (sectionsToDelete.length > 0) {
        await prisma.blog_sections.deleteMany({ where: { id: { in: sectionsToDelete } } });
      }

      // Upsert sections and blocks
      for (const section of sections) {
        const sectionPayload = {
          blog_id: blogId,
          section_key: section.section_key || section.title?.toLowerCase().replace(/\s+/g, '-'),
          title: section.title,
          subtitle: section.subtitle || null,
          display_order: section.display_order ?? 0,
          is_collapsible: section.is_collapsible ?? false,
          is_expanded: section.is_expanded ?? true,
          background_color: section.background_color || null,
          text_color: section.text_color || null,
          settings: section.settings || {}
        };

        let sectionId = section.id;

        if (!sectionId || sectionId.startsWith('temp-')) {
          const newSection = await prisma.blog_sections.create({ data: sectionPayload });
          sectionId = newSection.id;
        } else {
          await prisma.blog_sections.update({ where: { id: sectionId }, data: sectionPayload });
        }

        // Handle blocks
        const blocks = section.blocks || [];
        const existingBlocks = await prisma.blog_blocks.findMany({
          where: { section_id: sectionId },
          select: { id: true },
        });

        const existingBlockIds = existingBlocks.map(b => b.id);
        const incomingBlockIds = blocks.filter(b => b.id && !b.id.startsWith('temp-')).map(b => b.id);

        const blocksToDelete = existingBlockIds.filter(id => !incomingBlockIds.includes(id));
        if (blocksToDelete.length > 0) {
          await prisma.blog_blocks.deleteMany({ where: { id: { in: blocksToDelete } } });
        }

        for (const block of blocks) {
          const blockPayload = {
            section_id: sectionId,
            block_type: block.block_type,
            content: block.content || {},
            settings: block.settings || {},
            display_order: block.display_order ?? 0
          };

          if (!block.id || block.id.startsWith('temp-')) {
            await prisma.blog_blocks.create({ data: blockPayload });
          } else {
            await prisma.blog_blocks.update({ where: { id: block.id }, data: blockPayload });
          }
        }
      }

      await invalidateBlogCache(blogId, null);
      res.json({ success: true, message: 'Blog content synced successfully' });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to sync blog content', error);
    }
  },

  // Upload media for blog
  async uploadMedia(req, res) {
    try {
      const { blogId } = req.params;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const uploadFolder = `blogs/${blogId}`;
      const uploadResult = await uploadToR2(file, uploadFolder);

      if (!uploadResult?.url) {
        return res.status(500).json({ error: 'Failed to upload file to storage' });
      }

      res.status(201).json({
        success: true,
        file_url: uploadResult.url,
        file_name: uploadResult.fileName || file.originalname
      });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to upload media', error);
    }
  }
};

module.exports = blogController;
