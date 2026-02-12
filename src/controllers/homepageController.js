const supabase = require('../config/database');
const logger = require('../config/logger');
const { uploadToR2 } = require('../utils/fileUpload');

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
  const { data, error } = await supabase
    .from('homepage_hero')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  if (data) return data;

  const { data: inserted, error: insertError } = await supabase
    .from('homepage_hero')
    .insert({
      slug,
      title: 'Your Personal Government Exam Guide',
      description:
        'Start your journey with us. Your tests, exams, quizzes, and the latest government exam updates in one place.',
      media_items: [],
    })
    .select('*')
    .single();

  if (insertError) {
    throw insertError;
  }

  return inserted;
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

    const { data, error } = await supabase
      .from('homepage_hero')
      .upsert(payload, { onConflict: 'slug' })
      .select('*')
      .single();

    if (error) {
      logger.error('Upsert homepage hero error:', error);
      return res.status(500).json(formatError('Failed to save homepage hero content'));
    }

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
  let query = supabase
    .from('homepage_banners')
    .select('*')
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (onlyActive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('Fetch homepage banners error:', error);
    return [];
  }

  return data || [];
};

const getHomepageData = async (req, res) => {
  try {
    const [heroResult, categoriesResult, examsResult, blogsResult, banners] = await Promise.all([
      supabase
        .from('homepage_hero')
        .select('*')
        .eq('slug', DEFAULT_SLUG)
        .maybeSingle(),
      supabase
        .from('exam_categories')
        .select('id, name, slug, description, logo_url, display_order, is_active')
        .or('is_active.eq.true,is_active.is.null')
        .order('display_order', { ascending: true }),
      supabase
        .from('exams')
        .select('id, title, duration, total_marks, total_questions, category, category_id, subcategory, subcategory_id, difficulty, status, start_date, end_date, pass_percentage, is_free, image_url, logo_url, thumbnail_url, negative_marking, negative_mark_value, allow_anytime, slug, url_path, exam_type, show_in_mock_tests')
        .eq('is_published', true)
        .is('deleted_at', null)
        .or('status.eq.ongoing,status.eq.anytime,allow_anytime.eq.true')
        .limit(4),
      supabase
        .from('blogs')
        .select('id, title, slug, excerpt, featured_image_url, category, tags, author_id, is_published, is_featured, published_at, created_at, view_count, read_time')
        .eq('is_published', true)
        .order('published_at', { ascending: false })
        .limit(10),
      fetchBanners(true),
    ]);

    let featuredArticles = blogsResult.data || [];

    if ((!featuredArticles || featuredArticles.length === 0) && blogsResult.error) {
      logger.warn('Homepage blogs fetch failed, falling back to legacy articles table', blogsResult.error);
    }

    if (!featuredArticles || featuredArticles.length === 0) {
      const { data: articleFallback } = await supabase
        .from('articles')
        .select('id, title, slug, excerpt, featured_image, category, tags, author_name, author_avatar, is_published, published_at, created_at, views, read_time')
        .eq('is_published', true)
        .order('published_at', { ascending: false })
        .limit(10);
      featuredArticles = articleFallback || [];
    }

    const categories = categoriesResult.data || [];
    const categoryIds = categories.map(c => c.id);

    let subcategoriesByCategory = {};
    if (categoryIds.length > 0) {
      const { data: allSubcategories } = await supabase
        .from('exam_subcategories')
        .select('id, name, slug, description, category_id, logo_url, display_order, is_active')
        .in('category_id', categoryIds)
        .or('is_active.eq.true,is_active.is.null')
        .order('display_order', { ascending: true });

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

    return res.json({
      success: true,
      data: {
        hero: heroResult.data || null,
        banners,
        categories: categories.map(cat => ({
          ...cat,
          subcategories: subcategoriesByCategory[cat.id] || []
        })),
        featuredExams: examsResult.data || [],
        featuredArticles
      }
    });
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
      const { count } = await supabase
        .from('homepage_banners')
        .select('*', { count: 'exact', head: true });
      orderValue = (count || 0);
    }

    const payload = {
      title,
      subtitle: subtitle || null,
      image_url,
      link_url: link_url || null,
      button_text: button_text || null,
      display_order: orderValue,
      is_active: Boolean(is_active),
    };

    const { data, error } = await supabase
      .from('homepage_banners')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      logger.error('Create banner error:', error);
      return res.status(500).json(formatError('Failed to create banner'));
    }

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
    });

    if (!Object.keys(payload).length) {
      return res.status(400).json(formatError('No fields to update'));
    }

    const { data, error } = await supabase
      .from('homepage_banners')
      .update(payload)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error || !data) {
      logger.error('Update banner error:', error);
      return res.status(404).json(formatError('Banner not found or failed to update'));
    }

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

    const { error } = await supabase
      .from('homepage_banners')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error('Delete banner error:', error);
      return res.status(500).json(formatError('Failed to delete banner'));
    }

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

    const updates = order.map((id, index) =>
      supabase
        .from('homepage_banners')
        .update({ display_order: index })
        .eq('id', id)
    );

    await Promise.all(updates);

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
