const supabase = require('../config/database');
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
  const { data, error } = await supabase
    .from('about_page_content')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data || null;
};

const fetchCollection = async (table, includeInactive = false) => {
  let query = supabase
    .from(table)
    .select('*')
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
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
  const { error } = await supabase.from(table).upsert(items, { onConflict: 'id' });
  if (error) throw error;
};

const deleteCollectionItems = async (table, ids = []) => {
  if (!Array.isArray(ids) || !ids.length) return;
  const { error } = await supabase.from(table).delete().in('id', ids);
  if (error) throw error;
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

    if (existing?.id) {
      const { data, error } = await supabase
        .from('about_page_content')
        .update(contentPayload)
        .eq('id', existing.id)
        .select('*')
        .single();

      if (error) return handleSupabaseError(res, 'Failed to update About content', error);
      contentRecord = data;
    } else {
      const { data, error } = await supabase
        .from('about_page_content')
        .insert(contentPayload)
        .select('*')
        .single();

      if (error) return handleSupabaseError(res, 'Failed to create About content', error);
      contentRecord = data;
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
