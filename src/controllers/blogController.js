const supabase = require('../config/database');
const { uploadToR2 } = require('../utils/fileUpload');
const { slugify, ensureUniqueSlug } = require('../utils/slugify');

const buildErrorResponse = (res, message, error) => {
  console.error(message, error);
  return res.status(500).json({ error: message });
};

const blogController = {
  // Get all blogs (public + admin)
  async getBlogs(req, res) {
    try {
      const { page = 1, limit = 12, category, search, featured, published } = req.query;
      const offset = (page - 1) * limit;

      let query = supabase
        .from('blogs')
        .select('*', { count: 'exact' });

      // Public users only see published blogs
      if (!req.user || req.user.role !== 'admin') {
        query = query.eq('is_published', true);
      } else if (published !== undefined) {
        query = query.eq('is_published', published === 'true');
      }

      if (category) {
        query = query.eq('category', category);
      }

      if (featured === 'true') {
        query = query.eq('is_featured', true);
      }

      if (search) {
        query = query.or(`title.ilike.%${search}%,excerpt.ilike.%${search}%`);
      }

      const { data, error, count } = await query
        .order('published_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      if (error) {
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

      let query = supabase
        .from('blogs')
        .select('*')
        .eq('slug', slug)
        .single();

      const { data, error } = await query;

      if (error) {
        return res.status(404).json({ error: 'Blog not found' });
      }

      // Increment view count
      await supabase
        .from('blogs')
        .update({ view_count: (data.view_count || 0) + 1 })
        .eq('id', data.id);

      res.json({ success: true, data });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to fetch blog', error);
    }
  },

  // Get blog content (sections and blocks)
  async getBlogContent(req, res) {
    try {
      const { blogId } = req.params;

      const { data: sections, error: sectionsError } = await supabase
        .from('blog_sections')
        .select('*')
        .eq('blog_id', blogId)
        .order('display_order', { ascending: true });

      if (sectionsError) {
        return buildErrorResponse(res, 'Failed to fetch blog sections', sectionsError);
      }

      const sectionIds = sections.map(s => s.id);
      let blocks = [];

      if (sectionIds.length > 0) {
        const { data: blocksData, error: blocksError } = await supabase
          .from('blog_blocks')
          .select('*')
          .in('section_id', sectionIds)
          .order('display_order', { ascending: true });

        if (blocksError) {
          return buildErrorResponse(res, 'Failed to fetch blog blocks', blocksError);
        }

        blocks = blocksData || [];
      }

      const sectionsWithBlocks = sections.map(section => ({
        ...section,
        blocks: blocks.filter(block => block.section_id === section.id)
      }));

      res.json({
        success: true,
        sections: sectionsWithBlocks
      });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to fetch blog content', error);
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
        canonical_url
      } = req.body;

      if (!title) {
        return res.status(400).json({ error: 'Title is required' });
      }

      const baseSlug = customSlug || slugify(title);
      const uniqueSlug = await ensureUniqueSlug('blogs', baseSlug);

      const payload = {
        title,
        slug: uniqueSlug,
        excerpt: excerpt || null,
        featured_image_url: featured_image_url || null,
        author_id: req.user?.id || null,
        category: category || null,
        tags: tags || [],
        is_published: is_published || false,
        is_featured: is_featured || false,
        published_at: is_published ? new Date().toISOString() : null,
        meta_title: meta_title || null,
        meta_description: meta_description || null,
        meta_keywords: meta_keywords || null,
        og_title: og_title || null,
        og_description: og_description || null,
        og_image_url: og_image_url || null,
        canonical_url: canonical_url || null,
        created_by: req.user?.id || null,
        updated_by: req.user?.id || null
      };

      const { data, error } = await supabase
        .from('blogs')
        .insert([payload])
        .select()
        .single();

      if (error) {
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
        canonical_url
      } = req.body;

      const payload = {
        updated_by: req.user?.id || null,
        updated_at: new Date().toISOString()
      };

      if (title !== undefined) payload.title = title;
      if (customSlug !== undefined) {
        const uniqueSlug = await ensureUniqueSlug('blogs', customSlug, blogId);
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

      if (is_published !== undefined) {
        payload.is_published = is_published;
        if (is_published && !payload.published_at) {
          payload.published_at = new Date().toISOString();
        }
      }

      const { data, error } = await supabase
        .from('blogs')
        .update(payload)
        .eq('id', blogId)
        .select()
        .single();

      if (error) {
        return buildErrorResponse(res, 'Failed to update blog', error);
      }

      res.json({ success: true, data });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to update blog', error);
    }
  },

  // Delete blog
  async deleteBlog(req, res) {
    try {
      const { blogId } = req.params;

      const { error } = await supabase
        .from('blogs')
        .delete()
        .eq('id', blogId);

      if (error) {
        return buildErrorResponse(res, 'Failed to delete blog', error);
      }

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
      const { data: existingSections } = await supabase
        .from('blog_sections')
        .select('id')
        .eq('blog_id', blogId);

      const existingSectionIds = (existingSections || []).map(s => s.id);
      const incomingSectionIds = sections.filter(s => s.id && !s.id.startsWith('temp-')).map(s => s.id);

      // Delete removed sections
      const sectionsToDelete = existingSectionIds.filter(id => !incomingSectionIds.includes(id));
      if (sectionsToDelete.length > 0) {
        await supabase.from('blog_sections').delete().in('id', sectionsToDelete);
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
          const { data: newSection, error } = await supabase
            .from('blog_sections')
            .insert([sectionPayload])
            .select()
            .single();

          if (error) throw error;
          sectionId = newSection.id;
        } else {
          await supabase
            .from('blog_sections')
            .update(sectionPayload)
            .eq('id', sectionId);
        }

        // Handle blocks
        const blocks = section.blocks || [];
        const { data: existingBlocks } = await supabase
          .from('blog_blocks')
          .select('id')
          .eq('section_id', sectionId);

        const existingBlockIds = (existingBlocks || []).map(b => b.id);
        const incomingBlockIds = blocks.filter(b => b.id && !b.id.startsWith('temp-')).map(b => b.id);

        const blocksToDelete = existingBlockIds.filter(id => !incomingBlockIds.includes(id));
        if (blocksToDelete.length > 0) {
          await supabase.from('blog_blocks').delete().in('id', blocksToDelete);
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
            await supabase.from('blog_blocks').insert([blockPayload]);
          } else {
            await supabase.from('blog_blocks').update(blockPayload).eq('id', block.id);
          }
        }
      }

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
