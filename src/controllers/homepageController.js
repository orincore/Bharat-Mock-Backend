const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { uploadToR2 } = require('../utils/fileUpload');
const { redisCache, buildCacheKey } = require('../utils/redisCache');

const HOMEPAGE_TTL = 1800; // 30 minutes
const HOMEPAGE_CACHE_KEY = buildCacheKey('homepage', 'data');

const invalidateHomepageCache = async () => {
  await redisCache.del(HOMEPAGE_CACHE_KEY);
  console.log('[Cache] Invalidated homepage:data');
};

const DEFAULT_SLUG = 'default';

const formatError = (message) => ({ success: false, message });

const sanitizePayload = (payload) => {
  const clean = { ...payload };
  Object.keys(clean).forEach((key) => {
    if (clean[key] === undefined) {
      delete clean[key];
    }
  });
  return clean;
};

const parseJsonField = (value, fallback) => {
  if (Array.isArray(value) || typeof value === 'object') {
    return value;
  }

  if (typeof value === 'string' && value.trim().length) {
    try {
      return JSON.parse(value.trim());
    } catch (error) {
      logger.warn('Failed to parse JSON payload for homepage hero field', { value });
      return fallback;
    }
  }

  return fallback;
};

const ensureHeroRecord = async (slug = DEFAULT_SLUG) => {
  const data = await prisma.homepage_hero.findUnique({ where: { slug } });

  if (data) return data;

  return prisma.homepage_hero.create({
    data: {
      slug,
      title: 'Your Personal Government Exam Guide',
      description:
        'Start your journey with us. Your tests, exams, quizzes, and the latest government exam updates in one place.',
      media_items: [],
    },
  });
};

const getHero = async (req, res) => {
  try {
    const slug = req.params.slug || DEFAULT_SLUG;
    const hero = await ensureHeroRecord(slug);

    return res.json({ success: true, data: hero });
  } catch (error) {
    logger.error('Get homepage hero error:', error);
    return res.status(500).json(formatError('Failed to fetch homepage hero content'));
  }
};

const upsertHero = async (req, res) => {
  try {
    const {
      slug = DEFAULT_SLUG,
      title,
      subtitle,
      description,
      cta_primary_text,
      cta_primary_url,
      cta_secondary_text,
      cta_secondary_url,
      media_layout,
      background_video_url,
      media_items,
      meta_title,
      meta_description,
      meta_keywords,
      og_title,
      og_description,
      og_image_url,
      canonical_url,
      robots_meta,
      is_published,
    } = req.body;

    const normalizedMediaItems = parseJsonField(media_items, []);

    const payload = sanitizePayload({
      slug,
      title: title || null,
      subtitle: subtitle || null,
      description: description || null,
      cta_primary_text: cta_primary_text || null,
      cta_primary_url: cta_primary_url || null,
      cta_secondary_text: cta_secondary_text || null,
      cta_secondary_url: cta_secondary_url || null,
      media_layout: media_layout || null,
      background_video_url: background_video_url || null,
      media_items: normalizedMediaItems,
      meta_title: meta_title || null,
      meta_description: meta_description || null,
      meta_keywords: meta_keywords || null,
      og_title: og_title || null,
      og_description: og_description || null,
      og_image_url: og_image_url || null,
      canonical_url: canonical_url || null,
      robots_meta: robots_meta || null,
      is_published: typeof is_published === 'boolean' ? is_published : undefined,
      updated_by: req.user?.id || null,
    });

    let data;
    try {
      const { slug: payloadSlug, ...rest } = payload;
      data = await prisma.homepage_hero.upsert({
        where: { slug: payloadSlug },
        create: payload,
        update: rest,
      });
    } catch (error) {
      logger.error('Upsert homepage hero error:', error);
      return res.status(500).json(formatError('Failed to save homepage hero content'));
    }

    await invalidateHomepageCache();
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Upsert homepage hero exception:', error);
    return res.status(500).json(formatError('Server error while saving homepage hero content'));
  }
};

const uploadHeroMedia = async (req, res) => {
  try {
    const slug = req.body.slug || DEFAULT_SLUG;

    await ensureHeroRecord(slug);

    if (!req.file) {
      return res.status(400).json(formatError('Media file is required'));
    }

    const folder = `homepage/hero/${slug}`;
    const uploadResult = await uploadToR2(req.file, folder);

    if (!uploadResult?.url) {
      return res.status(500).json(formatError('Failed to upload media asset'));
    }

    const assetType = req.file.mimetype?.startsWith('video/') ? 'video' : 'image';

    return res.json({
      success: true,
      data: {
        url: uploadResult.url,
        key: uploadResult.key,
        mime_type: req.file.mimetype,
        size: req.file.size,
        original_name: req.file.originalname,
        asset_type: assetType,
      },
    });
  } catch (error) {
    logger.error('Upload homepage hero media error:', error);
    return res.status(500).json(formatError('Server error while uploading homepage media asset'));
  }
};

const fetchBanners = async (onlyActive = true) => {
  try {
    return await prisma.homepage_banners.findMany({
      where: onlyActive ? { is_active: true } : {},
      orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
    });
  } catch (error) {
    logger.error('Fetch homepage banners error:', error);
    return [];
  }
};

const getHomepageData = async (req, res) => {
  try {
    // Serve from cache (homepage data is public, no user-specific content)
    const cached = await redisCache.get(HOMEPAGE_CACHE_KEY);
    if (cached) {
      console.log('[Cache] HIT  homepage:data');
      return res.json(cached);
    }
    console.log('[Cache] MISS homepage:data — fetching from DB');

    const examWithCategorySelect = {
      id: true, title: true, duration: true, total_marks: true, total_questions: true, category: true, category_id: true,
      subcategory: true, subcategory_id: true, difficulty: true, status: true, start_date: true, end_date: true,
      pass_percentage: true, is_free: true, image_url: true, logo_url: true, thumbnail_url: true,
      negative_marking: true, negative_mark_value: true, allow_anytime: true, slug: true, url_path: true,
      exam_type: true, show_in_mock_tests: true, supports_hindi: true, is_premium: true,
      exam_categories: { select: { logo_url: true, icon: true } },
    };

    const [heroData, categoriesData, popularTestsData, blogsData, banners] = await Promise.all([
      prisma.homepage_hero.findUnique({ where: { slug: DEFAULT_SLUG } }),
      prisma.exam_categories.findMany({
        where: { OR: [{ is_active: true }, { is_active: null }] },
        select: { id: true, name: true, slug: true, description: true, logo_url: true, display_order: true, is_active: true },
        orderBy: { display_order: 'asc' },
      }),
      prisma.page_popular_tests.findMany({
        where: { page_identifier: 'homepage', is_active: true },
        select: { id: true, display_order: true, exams: { select: examWithCategorySelect } },
        orderBy: { display_order: 'asc' },
      }),
      prisma.blogs.findMany({
        where: { is_published: true },
        select: { id: true, title: true, slug: true, excerpt: true, featured_image_url: true, category: true, tags: true, author_id: true, is_published: true, is_featured: true, published_at: true, created_at: true, view_count: true, read_time: true },
        orderBy: { published_at: 'desc' },
        take: 10,
      }),
      fetchBanners(true),
    ]);

    // Use curated exams from page_popular_tests if available, otherwise fall back to dynamic fetch
    let featuredExams = [];
    const curatedTests = popularTestsData?.filter(item => item.exams) || [];
    if (curatedTests.length > 0) {
      featuredExams = curatedTests.map(item => item.exams);
    } else {
      featuredExams = await prisma.exams.findMany({
        where: {
          is_published: true,
          deleted_at: null,
          OR: [{ is_current_affair: false }, { is_current_affair: null }],
          AND: [{ OR: [{ status: 'ongoing' }, { status: 'anytime' }, { allow_anytime: true }] }],
        },
        select: examWithCategorySelect,
        take: 4,
      });
    }

    let featuredArticles = blogsData || [];

    if (!featuredArticles || featuredArticles.length === 0) {
      // BUGFIX (2026-07-20): this fallback selected featured_image/tags/author_name/
      // author_avatar, none of which are real columns on `articles` — real columns are
      // image_url, no tags column, and author info via the authors relation (see
      // MIGRATION_TRACKER.md §4.5). Query real columns/relation, then flatten to the
      // same output shape (featured_image/author_name/author_avatar/tags) the frontend
      // presumably expects, so this is a query fix, not an API contract change.
      try {
        const rows = await prisma.articles.findMany({
          where: { is_published: true },
          select: {
            id: true, title: true, slug: true, excerpt: true, image_url: true, category: true,
            is_published: true, published_at: true, created_at: true, views: true, read_time: true,
            authors: { select: { name: true, avatar_url: true } },
          },
          orderBy: { published_at: 'desc' },
          take: 10,
        });
        featuredArticles = rows.map(({ authors, image_url, ...rest }) => ({
          ...rest,
          featured_image: image_url,
          author_name: authors?.name || null,
          author_avatar: authors?.avatar_url || null,
          tags: [],
        }));
      } catch (fallbackError) {
        logger.warn('Homepage articles fallback failed', fallbackError);
        featuredArticles = [];
      }
    }

    const categories = categoriesData || [];
    const categoryIds = categories.map(c => c.id);

    let subcategoriesByCategory = {};
    if (categoryIds.length > 0) {
      const allSubcategories = await prisma.exam_subcategories.findMany({
        where: {
          category_id: { in: categoryIds },
          OR: [{ is_active: true }, { is_active: null }],
        },
        select: { id: true, name: true, slug: true, description: true, category_id: true, logo_url: true, display_order: true, is_active: true },
        orderBy: { display_order: 'asc' },
      });

      if (allSubcategories) {
        for (const sub of allSubcategories) {
          if (!sub.name || !sub.slug) continue;
          if (!subcategoriesByCategory[sub.category_id]) {
            subcategoriesByCategory[sub.category_id] = [];
          }
          subcategoriesByCategory[sub.category_id].push(sub);
        }
      }
    }

    const responsePayload = {
      success: true,
      data: {
        hero: heroData || null,
        banners,
        categories: categories.map(cat => ({
          ...cat,
          subcategories: subcategoriesByCategory[cat.id] || []
        })),
        featuredExams,
        featuredArticles
      }
    };

    await redisCache.set(HOMEPAGE_CACHE_KEY, responsePayload, HOMEPAGE_TTL);
    console.log(`[Cache] SET  homepage:data (TTL ${HOMEPAGE_TTL}s)`);

    return res.json(responsePayload);
  } catch (error) {
    logger.error('Get homepage data error:', error);
    return res.status(500).json(formatError('Failed to fetch homepage data'));
  }
};

const getBanners = async (req, res) => {
  try {
    const includeInactive = req.query.include_inactive === 'true';
    const banners = await fetchBanners(!includeInactive);
    return res.json({ success: true, data: banners });
  } catch (error) {
    logger.error('Get banners error:', error);
    return res.status(500).json(formatError('Failed to fetch homepage banners'));
  }
};

const createBanner = async (req, res) => {
  try {
    const {
      title,
      subtitle,
      image_url,
      link_url,
      button_text,
      display_order,
      is_active = true,
    } = req.body;

    if (!title || !image_url) {
      return res.status(400).json(formatError('Title and image URL are required'));
    }

    let orderValue = Number(display_order);
    if (!Number.isFinite(orderValue)) {
      orderValue = await prisma.homepage_banners.count();
    }

    const normalizePlacement = (value) => (value && value.toLowerCase() === 'mid' ? 'mid' : 'top');

    const payload = {
      title,
      subtitle: subtitle || null,
      image_url,
      link_url: link_url || null,
      button_text: button_text || null,
      display_order: orderValue,
      is_active: Boolean(is_active),
      placement: normalizePlacement(req.body.placement)
    };

    let data;
    try {
      data = await prisma.homepage_banners.create({ data: payload });
    } catch (error) {
      logger.error('Create banner error:', error);
      return res.status(500).json(formatError('Failed to create banner'));
    }

    await invalidateHomepageCache();
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Create banner exception:', error);
    return res.status(500).json(formatError('Server error while creating banner'));
  }
};

const updateBanner = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json(formatError('Banner ID is required'));
    }

    const payload = sanitizePayload({
      title: req.body.title,
      subtitle: req.body.subtitle,
      image_url: req.body.image_url,
      link_url: req.body.link_url,
      button_text: req.body.button_text,
      display_order: Number.isFinite(Number(req.body.display_order)) ? Number(req.body.display_order) : undefined,
      is_active: typeof req.body.is_active === 'boolean' ? req.body.is_active : undefined,
      placement: req.body.placement ? (req.body.placement.toLowerCase() === 'mid' ? 'mid' : 'top') : undefined,
    });

    if (!Object.keys(payload).length) {
      return res.status(400).json(formatError('No fields to update'));
    }

    let data;
    try {
      data = await prisma.homepage_banners.update({ where: { id }, data: payload });
    } catch (error) {
      logger.error('Update banner error:', error);
      return res.status(404).json(formatError('Banner not found or failed to update'));
    }

    await invalidateHomepageCache();
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Update banner exception:', error);
    return res.status(500).json(formatError('Server error while updating banner'));
  }
};

const deleteBanner = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json(formatError('Banner ID is required'));
    }

    try {
      await prisma.homepage_banners.delete({ where: { id } });
    } catch (error) {
      logger.error('Delete banner error:', error);
      return res.status(500).json(formatError('Failed to delete banner'));
    }

    await invalidateHomepageCache();
    return res.json({ success: true });
  } catch (error) {
    logger.error('Delete banner exception:', error);
    return res.status(500).json(formatError('Server error while deleting banner'));
  }
};

const reorderBanners = async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json(formatError('Order array is required'));
    }

    await prisma.$transaction(
      order.map((id, index) => prisma.homepage_banners.update({ where: { id }, data: { display_order: index } }))
    );

    await invalidateHomepageCache();
    return res.json({ success: true });
  } catch (error) {
    logger.error('Reorder banners error:', error);
    return res.status(500).json(formatError('Failed to reorder banners'));
  }
};

const uploadBannerImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json(formatError('Image file is required'));
    }

    const folder = 'homepage/banners';
    const uploadResult = await uploadToR2(req.file, folder);

    if (!uploadResult?.url) {
      return res.status(500).json(formatError('Failed to upload banner image'));
    }

    return res.json({
      success: true,
      data: {
        url: uploadResult.url,
        key: uploadResult.key,
        mime_type: req.file.mimetype,
        size: req.file.size,
        original_name: req.file.originalname,
      },
    });
  } catch (error) {
    logger.error('Upload banner image error:', error);
    return res.status(500).json(formatError('Server error while uploading banner image'));
  }
};

module.exports = {
  getHero,
  getHomepageData,
  upsertHero,
  uploadHeroMedia,
  getBanners,
  createBanner,
  updateBanner,
  deleteBanner,
  reorderBanners,
  uploadBannerImage,
};
