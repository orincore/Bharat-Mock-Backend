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

module.exports = {
  getHero,
  upsertHero,
  uploadHeroMedia,
};
