const supabase = require('../config/database');
const logger = require('../config/logger');
const { uploadToR2, deleteFromR2 } = require('../utils/fileUpload');
const { R2_PUBLIC_URL } = require('../config/r2');

const TABLE = 'testimonials';

const baseSelect = `
  id,
  name,
  profile_photo_url,
  review,
  exam,
  highlight,
  is_published,
  display_order,
  created_at,
  updated_at
`;

const formatTestimonial = (record) => ({
  id: record.id,
  name: record.name,
  profilePhotoUrl: record.profile_photo_url,
  review: record.review,
  exam: record.exam,
  highlight: record.highlight,
  isPublished: record.is_published,
  displayOrder: record.display_order,
  createdAt: record.created_at,
  updatedAt: record.updated_at
});

const extractR2Key = (url) => {
  if (!url || !R2_PUBLIC_URL) return null;
  return url.replace(`${R2_PUBLIC_URL}/`, '');
};

const getPublicTestimonials = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 12, 50);

    const { data, error } = await supabase
      .from(TABLE)
      .select(baseSelect)
      .eq('is_published', true)
      .order('highlight', { ascending: false })
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('[testimonials] get public error', error);
      return res.status(500).json({ success: false, message: 'Failed to load testimonials' });
    }

    return res.json({
      success: true,
      data: (data || []).map(formatTestimonial)
    });
  } catch (err) {
    logger.error('[testimonials] get public exception', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const adminCreateTestimonial = async (req, res) => {
  try {
    const { name, review, exam, displayOrder } = req.body || {};

    if (!name || !review) {
      return res.status(400).json({ success: false, message: 'Name and review are required' });
    }

    let profilePhotoUrl = null;
    if (req.file) {
      const uploadResult = await uploadToR2(req.file, 'testimonials');
      profilePhotoUrl = uploadResult.url;
    }

    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        name: name.slice(0, 150),
        profile_photo_url: profilePhotoUrl,
        review,
        exam: exam || null,
        display_order: displayOrder ? parseInt(displayOrder, 10) : 0
      })
      .select(baseSelect)
      .single();

    if (error) {
      logger.error('[testimonials] admin create error', error);
      return res.status(500).json({ success: false, message: 'Failed to create testimonial' });
    }

    return res.status(201).json({ success: true, data: formatTestimonial(data) });
  } catch (err) {
    logger.error('[testimonials] admin create exception', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getAllTestimonialsAdmin = async (req, res) => {
  try {
    const { highlight } = req.query;
    let query = supabase
      .from(TABLE)
      .select(baseSelect)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: false });

    if (typeof highlight !== 'undefined') {
      query = query.eq('highlight', highlight === 'true');
    }

    const { data, error } = await query;

    if (error) {
      logger.error('[testimonials] admin list error', error);
      return res.status(500).json({ success: false, message: 'Failed to load testimonials' });
    }

    return res.json({ success: true, data: (data || []).map(formatTestimonial) });
  } catch (err) {
    logger.error('[testimonials] admin list exception', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const adminUpdateTestimonial = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, review, exam, highlight, isPublished, displayOrder } = req.body || {};

    const { data: existing, error: fetchError } = await supabase
      .from(TABLE)
      .select('profile_photo_url')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !existing) {
      return res.status(404).json({ success: false, message: 'Testimonial not found' });
    }

    const updates = {};
    if (typeof name !== 'undefined') updates.name = name.slice(0, 150);
    if (typeof review !== 'undefined') updates.review = review;
    if (typeof exam !== 'undefined') updates.exam = exam || null;
    if (typeof highlight !== 'undefined') updates.highlight = Boolean(highlight);
    if (typeof isPublished !== 'undefined') updates.is_published = Boolean(isPublished);
    if (typeof displayOrder !== 'undefined') updates.display_order = parseInt(displayOrder, 10);

    if (req.file) {
      if (existing.profile_photo_url) {
        const oldKey = extractR2Key(existing.profile_photo_url);
        if (oldKey) {
          try {
            await deleteFromR2(oldKey);
          } catch (delErr) {
            logger.warn('[testimonials] failed to delete old photo', delErr);
          }
        }
      }
      const uploadResult = await uploadToR2(req.file, 'testimonials');
      updates.profile_photo_url = uploadResult.url;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, message: 'No updates provided' });
    }

    const { data, error } = await supabase
      .from(TABLE)
      .update(updates)
      .eq('id', id)
      .select(baseSelect)
      .maybeSingle();

    if (error || !data) {
      logger.error('[testimonials] admin update error', error);
      return res.status(500).json({ success: false, message: 'Failed to update testimonial' });
    }

    return res.json({ success: true, data: formatTestimonial(data) });
  } catch (err) {
    logger.error('[testimonials] admin update exception', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const adminDeleteTestimonial = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing, error: fetchError } = await supabase
      .from(TABLE)
      .select('profile_photo_url')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !existing) {
      return res.status(404).json({ success: false, message: 'Testimonial not found' });
    }

    if (existing.profile_photo_url) {
      const key = extractR2Key(existing.profile_photo_url);
      if (key) {
        try {
          await deleteFromR2(key);
        } catch (delErr) {
          logger.warn('[testimonials] failed to delete photo on delete', delErr);
        }
      }
    }

    const { error } = await supabase
      .from(TABLE)
      .delete()
      .eq('id', id);

    if (error) {
      logger.error('[testimonials] admin delete error', error);
      return res.status(500).json({ success: false, message: 'Failed to delete testimonial' });
    }

    return res.json({ success: true });
  } catch (err) {
    logger.error('[testimonials] admin delete exception', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  getPublicTestimonials,
  getAllTestimonialsAdmin,
  adminCreateTestimonial,
  adminUpdateTestimonial,
  adminDeleteTestimonial
};
