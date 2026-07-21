const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { uploadToR2, deleteFromR2 } = require('../utils/fileUpload');
const { R2_PUBLIC_URL } = require('../config/r2');

const baseSelect = {
  id: true, name: true, profile_photo_url: true, review: true, exam: true,
  highlight: true, is_published: true, display_order: true, created_at: true, updated_at: true,
};

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

    const data = await prisma.testimonials.findMany({
      where: { is_published: true },
      select: baseSelect,
      orderBy: [{ highlight: 'desc' }, { display_order: 'asc' }, { created_at: 'desc' }],
      take: limit,
    });

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

    let data;
    try {
      data = await prisma.testimonials.create({
        data: {
          name: name.slice(0, 150),
          profile_photo_url: profilePhotoUrl,
          review,
          exam: exam || null,
          display_order: displayOrder ? parseInt(displayOrder, 10) : 0
        },
        select: baseSelect,
      });
    } catch (error) {
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
    const where = {};
    if (typeof highlight !== 'undefined') {
      where.highlight = highlight === 'true';
    }

    let data;
    try {
      data = await prisma.testimonials.findMany({
        where,
        select: baseSelect,
        orderBy: [{ display_order: 'asc' }, { created_at: 'desc' }],
      });
    } catch (error) {
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

    const existing = await prisma.testimonials.findUnique({
      where: { id },
      select: { profile_photo_url: true },
    });

    if (!existing) {
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

    let data;
    try {
      data = await prisma.testimonials.update({ where: { id }, data: updates, select: baseSelect });
    } catch (error) {
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

    const existing = await prisma.testimonials.findUnique({
      where: { id },
      select: { profile_photo_url: true },
    });

    if (!existing) {
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

    try {
      await prisma.testimonials.delete({ where: { id } });
    } catch (error) {
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
