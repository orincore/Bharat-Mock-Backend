const supabase = require('../config/database');
const logger = require('../config/logger');

const TABLE = 'testimonials';

const baseSelect = `
  id,
  user_id,
  title,
  content,
  rating,
  highlight,
  is_published,
  created_at,
  updated_at,
  users (
    id,
    name,
    email,
    avatar_url
  )
`;

const formatTestimonial = (record) => ({
  id: record.id,
  userId: record.user_id,
  title: record.title,
  content: record.content,
  rating: record.rating,
  highlight: record.highlight,
  isPublished: record.is_published,
  createdAt: record.created_at,
  updatedAt: record.updated_at,
  user: record.users
    ? {
        id: record.users.id,
        name: record.users.name,
        email: record.users.email,
        avatarUrl: record.users.avatar_url
      }
    : null
});

const getPublicTestimonials = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 12, 50);

    const { data, error } = await supabase
      .from(TABLE)
      .select(baseSelect)
      .eq('is_published', true)
      .order('highlight', { ascending: false })
      .order('rating', { ascending: false })
      .order('updated_at', { ascending: false })
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

const getMyTestimonial = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const { data, error } = await supabase
      .from(TABLE)
      .select(baseSelect)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logger.error('[testimonials] get mine error', error);
      return res.status(500).json({ success: false, message: 'Failed to load testimonial' });
    }

    return res.json({ success: true, data: data ? formatTestimonial(data) : null });
  } catch (err) {
    logger.error('[testimonials] get mine exception', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const createTestimonial = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { title, content, rating } = req.body || {};

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (!content || typeof rating === 'undefined') {
      return res.status(400).json({ success: false, message: 'Content and rating are required' });
    }

    const intRating = Number(rating);
    if (Number.isNaN(intRating) || intRating < 1 || intRating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
    }

    const { data: existing } = await supabase
      .from(TABLE)
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ success: false, message: 'You already submitted a testimonial' });
    }

    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        user_id: userId,
        title: title?.slice(0, 150) || null,
        content,
        rating: intRating
      })
      .select(baseSelect)
      .single();

    if (error) {
      logger.error('[testimonials] create error', error);
      return res.status(500).json({ success: false, message: 'Failed to submit testimonial' });
    }

    return res.status(201).json({ success: true, data: formatTestimonial(data) });
  } catch (err) {
    logger.error('[testimonials] create exception', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const updateOwnTestimonial = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const { title, content, rating } = req.body || {};

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (!content && typeof title === 'undefined' && typeof rating === 'undefined') {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }

    const intRating = typeof rating !== 'undefined' ? Number(rating) : undefined;
    if (typeof intRating !== 'undefined' && (Number.isNaN(intRating) || intRating < 1 || intRating > 5)) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
    }

    const updates = {};
    if (typeof title !== 'undefined') updates.title = title?.slice(0, 150) || null;
    if (typeof content !== 'undefined') updates.content = content;
    if (typeof intRating !== 'undefined') updates.rating = intRating;

    const { data, error } = await supabase
      .from(TABLE)
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select(baseSelect)
      .maybeSingle();

    if (error || !data) {
      logger.error('[testimonials] update own error', error);
      return res.status(404).json({ success: false, message: 'Testimonial not found' });
    }

    return res.json({ success: true, data: formatTestimonial(data) });
  } catch (err) {
    logger.error('[testimonials] update own exception', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const deleteOwnTestimonial = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const { error } = await supabase
      .from(TABLE)
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      logger.error('[testimonials] delete own error', error);
      return res.status(500).json({ success: false, message: 'Failed to delete testimonial' });
    }

    return res.json({ success: true });
  } catch (err) {
    logger.error('[testimonials] delete own exception', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getAllTestimonialsAdmin = async (req, res) => {
  try {
    const { highlight } = req.query;
    let query = supabase
      .from(TABLE)
      .select(baseSelect)
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
    const { highlight, isPublished } = req.body || {};

    const updates = {};
    if (typeof highlight !== 'undefined') updates.highlight = Boolean(highlight);
    if (typeof isPublished !== 'undefined') updates.is_published = Boolean(isPublished);

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
      return res.status(404).json({ success: false, message: 'Testimonial not found' });
    }

    return res.json({ success: true, data: formatTestimonial(data) });
  } catch (err) {
    logger.error('[testimonials] admin update exception', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  getPublicTestimonials,
  getMyTestimonial,
  createTestimonial,
  updateOwnTestimonial,
  deleteOwnTestimonial,
  getAllTestimonialsAdmin,
  adminUpdateTestimonial
};
