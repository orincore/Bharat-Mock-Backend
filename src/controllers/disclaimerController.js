const prisma = require('../config/prisma');
const logger = require('../config/logger');

const disclaimerFields = ['title', 'last_updated', 'intro_body', 'contact_email', 'contact_url'];

const handleError = (res, message, error) => {
  logger.error(message, error);
  return res.status(500).json({ success: false, message });
};

const getDisclaimerContent = async () => {
  const data = await prisma.disclaimer_content.findFirst({
    orderBy: { created_at: 'asc' },
  });

  return data || null;
};

const getSectionsWithPoints = async (includeInactive = false) => {
  const sections = await prisma.disclaimer_sections.findMany({
    where: includeInactive ? {} : { is_active: true },
    orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
  });

  const sectionIds = sections.map((section) => section.id);
  if (!sectionIds.length) {
    return [];
  }

  const points = await prisma.disclaimer_points.findMany({
    where: {
      section_id: { in: sectionIds },
      ...(includeInactive ? {} : { is_active: true }),
    },
    orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
  });

  return sections.map((section) => ({
    ...section,
    points: points.filter((point) => point.section_id === section.id)
  }));
};

const getDisclaimerData = async (options = { includeInactive: false }) => {
  const [content, sections] = await Promise.all([
    getDisclaimerContent(),
    getSectionsWithPoints(options.includeInactive)
  ]);

  return { content, sections };
};

const sanitizeContentPayload = (payload = {}) => {
  const sanitized = {};
  disclaimerFields.forEach((field) => {
    if (payload[field] !== undefined) {
      sanitized[field] = payload[field];
    }
  });

  if (!sanitized.title || !sanitized.last_updated) {
    return null;
  }

  // Prisma needs a real Date (or full ISO-8601 datetime string) for @db.Date columns —
  // a bare "YYYY-MM-DD" string throws "premature end of input. Expected ISO-8601 DateTime."
  sanitized.last_updated = new Date(sanitized.last_updated);

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
  return prisma.$transaction(items.map((item) => {
    const { id, ...data } = item;
    return prisma[table].upsert({ where: { id }, create: item, update: data });
  }));
};

const insertRecords = async (table, items = []) => {
  if (!items.length) return [];
  return prisma.$transaction(items.map((item) => prisma[table].create({ data: item })));
};

const deleteRecords = async (table, ids = []) => {
  if (!Array.isArray(ids) || !ids.length) return;
  await prisma[table].deleteMany({ where: { id: { in: ids } } });
};

const publicDisclaimer = async (req, res) => {
  try {
    const data = await getDisclaimerData({ includeInactive: false });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, 'Failed to fetch Disclaimer', error);
  }
};

const adminGetDisclaimer = async (req, res) => {
  try {
    const data = await getDisclaimerData({ includeInactive: true });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, 'Failed to fetch Disclaimer', error);
  }
};

const adminUpsertDisclaimer = async (req, res) => {
  try {
    const payload = sanitizeContentPayload(req.body || {});
    if (!payload) {
      return res.status(400).json({ success: false, message: 'Title and last updated date are required.' });
    }

    const existing = await getDisclaimerContent();
    try {
      if (existing?.id) {
        await prisma.disclaimer_content.update({ where: { id: existing.id }, data: payload });
      } else {
        await prisma.disclaimer_content.create({ data: payload });
      }
    } catch (error) {
      return handleError(res, existing?.id ? 'Failed to update Disclaimer content' : 'Failed to create Disclaimer content', error);
    }

    const sectionsPayload = sanitizeSections(req.body.sections || []);
    const pointsPayload = sanitizePoints(req.body.points || []);

    const newSections = sectionsPayload.filter((section) => !section.id);
    const existingSections = sectionsPayload.filter((section) => section.id);

    const insertedSections = newSections.length ? await insertRecords('disclaimer_sections', newSections) : [];
    const upsertedSections = existingSections.length ? await upsertRecords('disclaimer_sections', existingSections) : [];
    const sectionsMap = [...insertedSections, ...upsertedSections];

    const pointsWithSections = pointsPayload
      .map((point) => {
        // BUGFIX (2026-07-20): disclaimer_points has no `section_title` column — this
        // field exists only to resolve a new point's section_id by matching against a
        // newly-created section's title, and must never reach the DB write itself.
        // The sibling privacy/refund policy controllers already strip it; this file was
        // missing that step, which meant saving a disclaimer point (create OR update)
        // always failed with a "column does not exist" error in production.
        const { section_title, ...dbPoint } = point;
        if (dbPoint.section_id) {
          return dbPoint;
        }
        const matching = sectionsMap.find((section) => section.title === section_title);
        return {
          ...dbPoint,
          section_id: matching?.id || null
        };
      })
      .filter((point) => point.section_id);

    const newPoints = pointsWithSections.filter((point) => !point.id);
    const existingPoints = pointsWithSections.filter((point) => point.id);

    await Promise.all([
      newPoints.length ? insertRecords('disclaimer_points', newPoints) : Promise.resolve(),
      existingPoints.length ? upsertRecords('disclaimer_points', existingPoints) : Promise.resolve(),
      deleteRecords('disclaimer_sections', req.body.deleted_section_ids || []),
      deleteRecords('disclaimer_points', req.body.deleted_point_ids || [])
    ]);

    const refreshed = await getDisclaimerData({ includeInactive: true });
    return res.json({ success: true, data: refreshed });
  } catch (error) {
    return handleError(res, 'Failed to save Disclaimer', error);
  }
};

module.exports = {
  publicDisclaimer,
  adminGetDisclaimer,
  adminUpsertDisclaimer
};
