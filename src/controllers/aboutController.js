const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const logger = require('../config/logger');

const aboutFields = [
  'hero_heading',
  'hero_subheading',
  'hero_description',
  'hero_badge',
  'mission_heading',
  'mission_body',
  'story_heading',
  'story_body',
  'impact_heading',
  'impact_body',
  'offerings_heading',
  'offerings_body',
  'cta_label',
  'cta_href'
];

const handleSupabaseError = (res, message, error) => {
  logger.error(message, error);
  return res.status(500).json({ success: false, message });
};

const getAboutContent = async () => {
  const data = await prisma.about_page_content.findFirst({
    orderBy: { created_at: 'asc' },
  });

  return data || null;
};

const fetchCollection = async (table, includeInactive = false) => {
  const where = includeInactive ? {} : { is_active: true };
  return prisma[table].findMany({
    where,
    orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
  });
};

const getAboutData = async (options = { includeInactive: false }) => {
  const { includeInactive } = options;
  const [content, values, stats, offerings] = await Promise.all([
    getAboutContent(),
    fetchCollection('about_values', includeInactive),
    fetchCollection('about_stats', includeInactive),
    fetchCollection('about_offerings', includeInactive)
  ]);

  return {
    content,
    values,
    stats,
    offerings
  };
};

const sanitizeMainPayload = (payload = {}) => {
  const sanitized = {};
  aboutFields.forEach((field) => {
    if (payload[field] !== undefined) {
      sanitized[field] = payload[field];
    }
  });

  if (Object.keys(sanitized).length === 0) {
    return null;
  }

  sanitized.updated_at = new Date().toISOString();
  return sanitized;
};

const sanitizeCollection = (items = [], type = 'values') => {
  if (!Array.isArray(items)) return [];

  return items
    .filter((item) => item)
    .map((item, index) => {
      const base = {
        id: item.id,
        display_order: Number.isFinite(item.display_order) ? item.display_order : index,
        is_active: typeof item.is_active === 'boolean' ? item.is_active : true,
        updated_at: new Date().toISOString()
      };

      if (type === 'stats') {
        if (!item.label || !item.value) return null;
        return {
          ...base,
          label: item.label,
          value: item.value,
          helper_text: item.helper_text || null
        };
      }

      const payload = {
        ...base,
        title: item.title,
        description: item.description || null,
        icon: item.icon || null
      };

      if (!payload.title && type !== 'stats') {
        return null;
      }

      return payload;
    })
    .filter(Boolean);
};

const privateUpsertCollection = async (table, items = []) => {
  if (!items.length) return;
  await prisma.$transaction(items.map((item) => {
    const id = item.id || randomUUID();
    const { id: _omit, ...data } = item;
    return prisma[table].upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
  }));
};

const deleteCollectionItems = async (table, ids = []) => {
  if (!Array.isArray(ids) || !ids.length) return;
  await prisma[table].deleteMany({ where: { id: { in: ids } } });
};

const publicAbout = async (req, res) => {
  try {
    const data = await getAboutData({ includeInactive: false });
    return res.json({ success: true, data });
  } catch (error) {
    return handleSupabaseError(res, 'Failed to fetch About page content', error);
  }
};

const adminGetAbout = async (req, res) => {
  try {
    const data = await getAboutData({ includeInactive: true });
    return res.json({ success: true, data });
  } catch (error) {
    return handleSupabaseError(res, 'Failed to fetch About page content', error);
  }
};

const adminUpsertAbout = async (req, res) => {
  try {
    const contentPayload = sanitizeMainPayload(req.body || {});
    if (!contentPayload || !contentPayload.hero_heading) {
      return res.status(400).json({ success: false, message: 'Hero heading is required.' });
    }

    const existing = await getAboutContent();
    let contentRecord;

    try {
      if (existing?.id) {
        contentRecord = await prisma.about_page_content.update({
          where: { id: existing.id },
          data: contentPayload,
        });
      } else {
        contentRecord = await prisma.about_page_content.create({
          data: contentPayload,
        });
      }
    } catch (error) {
      return handleSupabaseError(res, existing?.id ? 'Failed to update About content' : 'Failed to create About content', error);
    }

    const sanitizedValues = sanitizeCollection(req.body.values || [], 'values');
    const sanitizedStats = sanitizeCollection(req.body.stats || [], 'stats');
    const sanitizedOfferings = sanitizeCollection(req.body.offerings || [], 'offerings');

    await Promise.all([
      privateUpsertCollection('about_values', sanitizedValues.map((item, index) => ({
        ...item,
        display_order: index
      }))),
      privateUpsertCollection('about_stats', sanitizedStats.map((item, index) => ({
        ...item,
        display_order: index
      }))),
      privateUpsertCollection('about_offerings', sanitizedOfferings.map((item, index) => ({
        ...item,
        display_order: index
      }))),
      deleteCollectionItems('about_values', req.body.deleted_value_ids || []),
      deleteCollectionItems('about_stats', req.body.deleted_stat_ids || []),
      deleteCollectionItems('about_offerings', req.body.deleted_offering_ids || [])
    ]);

    const refreshed = await getAboutData({ includeInactive: true });
    return res.json({ success: true, data: refreshed });
  } catch (error) {
    return handleSupabaseError(res, 'Failed to save About page content', error);
  }
};

module.exports = {
  publicAbout,
  adminGetAbout,
  adminUpsertAbout
};
