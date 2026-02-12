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

const getHomepageData = async (req, res) => {
  try {
    const [heroResult, categoriesResult, examsResult, blogsResult] = await Promise.all([
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
        .limit(10)
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

module.exports = {
  getHero,
  getHomepageData,
  upsertHero,
  uploadHeroMedia,
};
