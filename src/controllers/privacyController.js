const supabase = require('../config/database');
const logger = require('../config/logger');

const privacyFields = ['title', 'last_updated', 'intro_body', 'contact_email', 'contact_url'];

const handleError = (res, message, error) => {
  logger.error(message, error);
  return res.status(500).json({ success: false, message });
};

const getPolicyContent = async () => {
  const { data, error } = await supabase
    .from('privacy_policy_content')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data || null;
};

const getSectionsWithPoints = async (includeInactive = false) => {
  let sectionsQuery = supabase
    .from('privacy_policy_sections')
    .select('*')
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (!includeInactive) {
    sectionsQuery = sectionsQuery.eq('is_active', true);
  }

  const { data: sections, error: sectionsError } = await sectionsQuery;
  if (sectionsError) throw sectionsError;

  const sectionIds = (sections || []).map((section) => section.id);
  if (!sectionIds.length) {
    return [];
  }

  let pointsQuery = supabase
    .from('privacy_policy_points')
    .select('*')
    .in('section_id', sectionIds)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (!includeInactive) {
    pointsQuery = pointsQuery.eq('is_active', true);
  }

  const { data: points, error: pointsError } = await pointsQuery;
  if (pointsError) throw pointsError;

  return sections.map((section) => ({
    ...section,
    points: (points || []).filter((point) => point.section_id === section.id)
  }));
};

const getPrivacyPolicyData = async (options = { includeInactive: false }) => {
  const [content, sections] = await Promise.all([
    getPolicyContent(),
    getSectionsWithPoints(options.includeInactive)
  ]);

  return { content, sections };
};

const sanitizeContentPayload = (payload = {}) => {
  const sanitized = {};
  privacyFields.forEach((field) => {
    if (payload[field] !== undefined) {
      sanitized[field] = payload[field];
    }
  });

  if (!sanitized.title) {
    return null;
  }

  sanitized.updated_at = new Date().toISOString();
  return sanitized;
};

const sanitizeSections = (sections = []) => {
  if (!Array.isArray(sections)) return [];
  return sections
    .filter((section) => section && section.title)
    .map((section, index) => ({
      id: section.id,
      title: section.title,
      description: section.description || null,
      display_order: Number.isFinite(section.display_order) ? section.display_order : index,
      is_active: typeof section.is_active === 'boolean' ? section.is_active : true,
      updated_at: new Date().toISOString()
    }));
};

const sanitizePoints = (points = []) => {
  if (!Array.isArray(points)) return [];
  return points
    .filter((point) => point && (point.heading || point.body || (Array.isArray(point.list_items) && point.list_items.length)))
    .map((point, index) => ({
      id: point.id,
      section_id: point.section_id,
      section_title: point.section_title || null,
      heading: point.heading || null,
      body: point.body || null,
      list_items: Array.isArray(point.list_items) ? point.list_items : null,
      display_order: Number.isFinite(point.display_order) ? point.display_order : index,
      is_active: typeof point.is_active === 'boolean' ? point.is_active : true,
      updated_at: new Date().toISOString()
    }));
};

const upsertRecords = async (table, items = []) => {
  if (!items.length) return [];
  const { data, error } = await supabase.from(table).upsert(items, { onConflict: 'id' }).select('*');
  if (error) throw error;
  return data || [];
};

const insertRecords = async (table, items = []) => {
  if (!items.length) return [];
  const { data, error } = await supabase.from(table).insert(items).select('*');
  if (error) throw error;
  return data || [];
};

const deleteRecords = async (table, ids = []) => {
  if (!Array.isArray(ids) || !ids.length) return;
  const { error } = await supabase.from(table).delete().in('id', ids);
  if (error) throw error;
};

const publicPrivacyPolicy = async (req, res) => {
  try {
    const data = await getPrivacyPolicyData({ includeInactive: false });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, 'Failed to fetch Privacy Policy', error);
  }
};

const adminGetPrivacyPolicy = async (req, res) => {
  try {
    const data = await getPrivacyPolicyData({ includeInactive: true });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, 'Failed to fetch Privacy Policy', error);
  }
};

const adminUpsertPrivacyPolicy = async (req, res) => {
  try {
    const payload = sanitizeContentPayload(req.body || {});
    if (!payload) {
      return res.status(400).json({ success: false, message: 'Title and last updated date are required.' });
    }

    const existing = await getPolicyContent();
    if (existing?.id) {
      const { error } = await supabase
        .from('privacy_policy_content')
        .update(payload)
        .eq('id', existing.id);
      if (error) return handleError(res, 'Failed to update Privacy Policy content', error);
    } else {
      const { error } = await supabase
        .from('privacy_policy_content')
        .insert(payload);
      if (error) return handleError(res, 'Failed to create Privacy Policy content', error);
    }

    const sectionsPayload = sanitizeSections(req.body.sections || []);
    const pointsPayload = sanitizePoints(req.body.points || []);

    const newSections = sectionsPayload.filter((section) => !section.id);
    const existingSections = sectionsPayload.filter((section) => section.id);

    const insertedSections = newSections.length ? await insertRecords('privacy_policy_sections', newSections) : [];
    const upsertedSections = existingSections.length ? await upsertRecords('privacy_policy_sections', existingSections) : [];
    const sectionsMap = [...insertedSections, ...upsertedSections];

    const pointsWithSections = pointsPayload.map((point) => {
      if (point.section_id) {
        return point;
      }
      const matching = sectionsMap.find((section) => section.title === point.section_title);
      return {
        ...point,
        section_id: matching?.id || null
      };
    }).filter((point) => point.section_id);

    const newPoints = pointsWithSections.filter((point) => !point.id);
    const existingPoints = pointsWithSections.filter((point) => point.id);

    await Promise.all([
      newPoints.length ? insertRecords('privacy_policy_points', newPoints) : Promise.resolve(),
      existingPoints.length ? upsertRecords('privacy_policy_points', existingPoints) : Promise.resolve(),
      deleteRecords('privacy_policy_sections', req.body.deleted_section_ids || []),
      deleteRecords('privacy_policy_points', req.body.deleted_point_ids || [])
    ]);

    const refreshed = await getPrivacyPolicyData({ includeInactive: true });
    return res.json({ success: true, data: refreshed });
  } catch (error) {
    return handleError(res, 'Failed to save Privacy Policy', error);
  }
};

module.exports = {
  publicPrivacyPolicy,
  adminGetPrivacyPolicy,
  adminUpsertPrivacyPolicy
};
