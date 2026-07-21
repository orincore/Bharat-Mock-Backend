const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { uploadToR2, deleteFromR2 } = require('../utils/fileUpload');
const { R2_PUBLIC_URL } = require('../config/r2');

const parsePagination = (query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  return { page, limit, offset: (page - 1) * limit };
};

const verifySubcategory = async (subcategoryId) => {
  const subcategory = await prisma.exam_subcategories.findUnique({
    where: { id: subcategoryId },
    select: { id: true }
  });
  return Boolean(subcategory);
};

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

const extractStorageKey = (url) => {
  if (!url || !R2_PUBLIC_URL) return null;
  return url.replace(`${R2_PUBLIC_URL}/`, '');
};

const uploadHeroImage = async (req, res) => {
  try {
    const { subcategoryId } = req.params;

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    if (!req.file) {
      return res.status(400).json(formatError('Image file is required'));
    }

    let overview;
    try {
      overview = await prisma.subcategory_overviews.findUnique({
        where: { subcategory_id: subcategoryId },
        select: { id: true, hero_image_url: true }
      });
    } catch (error) {
      logger.error('Fetch overview for hero upload error:', error);
      return res.status(500).json(formatError('Failed to process existing overview'));
    }

    if (overview?.hero_image_url) {
      const existingKey = extractStorageKey(overview.hero_image_url);
      if (existingKey) {
        try {
          await deleteFromR2(existingKey);
        } catch (error) {
          logger.warn('Failed to delete previous hero image:', error);
        }
      }
    }

    const uploadResult = await uploadToR2(req.file, `subcategories/${subcategoryId}/hero`);

    if (!uploadResult?.url) {
      return res.status(500).json(formatError('Failed to upload hero image'));
    }

    const payload = {
      subcategory_id: subcategoryId,
      hero_image_url: uploadResult.url,
      updated_by: req.user?.id || null
    };

    let dbResult;
    try {
      if (overview?.id) {
        dbResult = await prisma.subcategory_overviews.update({
          where: { id: overview.id },
          data: payload,
          select: { hero_image_url: true }
        });
      } else {
        dbResult = await prisma.subcategory_overviews.create({
          data: { ...payload, created_by: req.user?.id || null },
          select: { hero_image_url: true }
        });
      }
    } catch (error) {
      logger.error('Save hero image url error:', error);
      return res.status(500).json(formatError('Failed to save hero image url'));
    }

    return res.json({
      success: true,
      data: {
        hero_image_url: dbResult.hero_image_url
      }
    });
  } catch (error) {
    logger.error('Upload hero image exception:', error);
    return res.status(500).json(formatError('Server error while uploading hero image'));
  }
};

const getOverview = async (req, res) => {
  try {
    const { subcategoryId } = req.params;

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    let data;
    try {
      data = await prisma.subcategory_overviews.findUnique({ where: { subcategory_id: subcategoryId } });
    } catch (error) {
      logger.error('Get overview error:', error);
      return res.status(500).json(formatError('Failed to fetch overview'));
    }

    return res.json({ success: true, data: data || null });
  } catch (error) {
    logger.error('Get overview exception:', error);
    return res.status(500).json(formatError('Server error while fetching overview'));
  }
};

const upsertOverview = async (req, res) => {
  try {
    const { subcategoryId } = req.params;
    const {
      hero_title,
      hero_subtitle,
      hero_description,
      hero_image_url,
      cta_primary_text,
      cta_primary_url,
      cta_secondary_text,
      cta_secondary_url,
      stats_json,
      meta_title,
      meta_description,
      meta_keywords
    } = req.body;

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    const payload = sanitizePayload({
      subcategory_id: subcategoryId,
      hero_title: hero_title || null,
      hero_subtitle: hero_subtitle || null,
      hero_description: hero_description || null,
      hero_image_url: hero_image_url || null,
      cta_primary_text: cta_primary_text || null,
      cta_primary_url: cta_primary_url || null,
      cta_secondary_text: cta_secondary_text || null,
      cta_secondary_url: cta_secondary_url || null,
      stats_json: stats_json || null,
      meta_title: meta_title || null,
      meta_description: meta_description || null,
      meta_keywords: meta_keywords || null,
      updated_by: req.user?.id || null
    });

    const existing = await prisma.subcategory_overviews.findUnique({
      where: { subcategory_id: subcategoryId },
      select: { id: true }
    });

    let data;
    try {
      if (existing) {
        data = await prisma.subcategory_overviews.update({
          where: { subcategory_id: subcategoryId },
          data: payload
        });
      } else {
        data = await prisma.subcategory_overviews.create({
          data: { ...payload, created_by: req.user?.id || null }
        });
      }
    } catch (error) {
      logger.error('Upsert overview error:', error);
      return res.status(500).json(formatError('Failed to save overview'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Upsert overview exception:', error);
    return res.status(500).json(formatError('Server error while saving overview'));
  }
};

const getUpdates = async (req, res) => {
  try {
    const { subcategoryId } = req.params;
    const { page, limit, offset } = parsePagination(req.query);

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    let data, count;
    try {
      [data, count] = await Promise.all([
        prisma.subcategory_updates.findMany({
          where: { subcategory_id: subcategoryId },
          orderBy: [{ update_date: 'desc' }, { display_order: 'asc' }],
          skip: offset,
          take: limit
        }),
        prisma.subcategory_updates.count({ where: { subcategory_id: subcategoryId } })
      ]);
    } catch (error) {
      logger.error('Get updates error:', error);
      return res.status(500).json(formatError('Failed to fetch updates'));
    }

    return res.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: count ? Math.ceil(count / limit) : 0
      }
    });
  } catch (error) {
    logger.error('Get updates exception:', error);
    return res.status(500).json(formatError('Server error while fetching updates'));
  }
};

const upsertUpdate = async (req, res) => {
  try {
    const { subcategoryId, updateId } = req.params;
    const {
      title,
      description,
      update_type,
      update_date,
      link_url,
      is_active = true,
      display_order = 0
    } = req.body;

    if (!title || !update_type || !update_date) {
      return res.status(400).json(formatError('Title, update type, and date are required'));
    }

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    const payload = sanitizePayload({
      subcategory_id: subcategoryId,
      title,
      description: description || null,
      update_type,
      update_date: new Date(update_date),
      link_url: link_url || null,
      is_active: is_active === true || is_active === 'true',
      display_order: parseInt(display_order, 10) || 0
    });

    let data;
    try {
      if (updateId) {
        const result = await prisma.subcategory_updates.updateMany({
          where: { id: updateId, subcategory_id: subcategoryId },
          data: { ...payload, updated_by: req.user?.id || null }
        });
        if (result.count === 0) {
          logger.error('Upsert update error: no matching row for', { updateId, subcategoryId });
          return res.status(500).json(formatError('Failed to save update'));
        }
        data = await prisma.subcategory_updates.findUnique({ where: { id: updateId } });
      } else {
        data = await prisma.subcategory_updates.create({
          data: { ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null }
        });
      }
    } catch (error) {
      logger.error('Upsert update error:', error);
      return res.status(500).json(formatError('Failed to save update'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Upsert update exception:', error);
    return res.status(500).json(formatError('Server error while saving update'));
  }
};

const deleteUpdate = async (req, res) => {
  try {
    const { subcategoryId, updateId } = req.params;

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    try {
      await prisma.subcategory_updates.deleteMany({ where: { id: updateId, subcategory_id: subcategoryId } });
    } catch (error) {
      logger.error('Delete update error:', error);
      return res.status(500).json(formatError('Failed to delete update'));
    }

    return res.json({ success: true, message: 'Update deleted successfully' });
  } catch (error) {
    logger.error('Delete update exception:', error);
    return res.status(500).json(formatError('Server error while deleting update'));
  }
};

const getHighlights = async (req, res) => {
  try {
    const { subcategoryId } = req.params;

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    let data;
    try {
      data = await prisma.subcategory_highlights.findMany({
        where: { subcategory_id: subcategoryId },
        orderBy: { display_order: 'asc' }
      });
    } catch (error) {
      logger.error('Get highlights error:', error);
      return res.status(500).json(formatError('Failed to fetch highlights'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get highlights exception:', error);
    return res.status(500).json(formatError('Server error while fetching highlights'));
  }
};

// ⚠️ PRE-EXISTING BUG (not introduced by this migration, preserved faithfully — see
// MIGRATION_TRACKER.md §4.5e): subcategory_highlights has no `highlight_type` column,
// and its real `value` column (NOT NULL) is never set here. Every create/update via this
// endpoint has always failed in production (confirmed: 0 real rows exist in this table).
const upsertHighlight = async (req, res) => {
  try {
    const { subcategoryId, highlightId } = req.params;
    const {
      title,
      description,
      icon,
      highlight_type = 'feature',
      display_order = 0,
      is_active = true
    } = req.body;

    if (!title) {
      return res.status(400).json(formatError('Title is required'));
    }

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    const payload = sanitizePayload({
      subcategory_id: subcategoryId,
      title,
      description: description || null,
      icon: icon || null,
      highlight_type,
      display_order: parseInt(display_order, 10) || 0,
      is_active: is_active === true || is_active === 'true'
    });

    let data;
    try {
      if (highlightId) {
        const result = await prisma.subcategory_highlights.updateMany({
          where: { id: highlightId, subcategory_id: subcategoryId },
          data: { ...payload, updated_by: req.user?.id || null }
        });
        if (result.count === 0) {
          logger.error('Upsert highlight error: no matching row for', { highlightId, subcategoryId });
          return res.status(500).json(formatError('Failed to save highlight'));
        }
        data = await prisma.subcategory_highlights.findUnique({ where: { id: highlightId } });
      } else {
        data = await prisma.subcategory_highlights.create({
          data: { ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null }
        });
      }
    } catch (error) {
      logger.error('Upsert highlight error:', error);
      return res.status(500).json(formatError('Failed to save highlight'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Upsert highlight exception:', error);
    return res.status(500).json(formatError('Server error while saving highlight'));
  }
};

const deleteHighlight = async (req, res) => {
  try {
    const { subcategoryId, highlightId } = req.params;

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    try {
      await prisma.subcategory_highlights.deleteMany({ where: { id: highlightId, subcategory_id: subcategoryId } });
    } catch (error) {
      logger.error('Delete highlight error:', error);
      return res.status(500).json(formatError('Failed to delete highlight'));
    }

    return res.json({ success: true, message: 'Highlight deleted successfully' });
  } catch (error) {
    logger.error('Delete highlight exception:', error);
    return res.status(500).json(formatError('Server error while deleting highlight'));
  }
};

const getExamStats = async (req, res) => {
  try {
    const { subcategoryId } = req.params;

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    let data;
    try {
      data = await prisma.subcategory_exam_stats.findMany({
        where: { subcategory_id: subcategoryId },
        orderBy: { display_order: 'asc' }
      });
    } catch (error) {
      logger.error('Get exam stats error:', error);
      return res.status(500).json(formatError('Failed to fetch exam stats'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get exam stats exception:', error);
    return res.status(500).json(formatError('Server error while fetching exam stats'));
  }
};

// ⚠️ PRE-EXISTING BUG (preserved faithfully — see MIGRATION_TRACKER.md §4.5e):
// subcategory_exam_stats.metric and .metric_year are NOT NULL columns with no default,
// and neither is ever set by this endpoint. Every create has always failed in
// production (confirmed: 0 real rows exist in this table).
const upsertExamStat = async (req, res) => {
  try {
    const { subcategoryId, statId } = req.params;
    const {
      stat_label,
      stat_value,
      stat_description,
      icon,
      display_order = 0,
      is_active = true
    } = req.body;

    if (!stat_label || !stat_value) {
      return res.status(400).json(formatError('Stat label and value are required'));
    }

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    const payload = sanitizePayload({
      subcategory_id: subcategoryId,
      stat_label,
      stat_value,
      stat_description: stat_description || null,
      icon: icon || null,
      display_order: parseInt(display_order, 10) || 0,
      is_active: is_active === true || is_active === 'true'
    });

    let data;
    try {
      if (statId) {
        const result = await prisma.subcategory_exam_stats.updateMany({
          where: { id: statId, subcategory_id: subcategoryId },
          data: { ...payload, updated_by: req.user?.id || null }
        });
        if (result.count === 0) {
          logger.error('Upsert exam stat error: no matching row for', { statId, subcategoryId });
          return res.status(500).json(formatError('Failed to save exam stat'));
        }
        data = await prisma.subcategory_exam_stats.findUnique({ where: { id: statId } });
      } else {
        data = await prisma.subcategory_exam_stats.create({
          data: { ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null }
        });
      }
    } catch (error) {
      logger.error('Upsert exam stat error:', error);
      return res.status(500).json(formatError('Failed to save exam stat'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Upsert exam stat exception:', error);
    return res.status(500).json(formatError('Server error while saving exam stat'));
  }
};

const deleteExamStat = async (req, res) => {
  try {
    const { subcategoryId, statId } = req.params;

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    try {
      await prisma.subcategory_exam_stats.deleteMany({ where: { id: statId, subcategory_id: subcategoryId } });
    } catch (error) {
      logger.error('Delete exam stat error:', error);
      return res.status(500).json(formatError('Failed to delete exam stat'));
    }

    return res.json({ success: true, message: 'Exam stat deleted successfully' });
  } catch (error) {
    logger.error('Delete exam stat exception:', error);
    return res.status(500).json(formatError('Server error while deleting exam stat'));
  }
};

const getSections = async (req, res) => {
  try {
    const { subcategoryId } = req.params;

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    let data;
    try {
      data = await prisma.subcategory_sections.findMany({
        where: { subcategory_id: subcategoryId },
        orderBy: { display_order: 'asc' }
      });
    } catch (error) {
      logger.error('Get sections error:', error);
      return res.status(500).json(formatError('Failed to fetch sections'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get sections exception:', error);
    return res.status(500).json(formatError('Server error while fetching sections'));
  }
};

// ⚠️ PRE-EXISTING BUG (preserved faithfully — see MIGRATION_TRACKER.md §4.5e):
// subcategory_sections has no `section_type` column, and its real `slug` column
// (NOT NULL) is never set here. Every create/update has always failed in production
// (confirmed: 0 real rows exist in this table).
const upsertSection = async (req, res) => {
  try {
    const { subcategoryId, sectionId } = req.params;
    const {
      title,
      subtitle,
      content,
      section_type = 'text',
      media_url,
      button_label,
      button_url,
      display_order = 0,
      is_active = true
    } = req.body;

    if (!title) {
      return res.status(400).json(formatError('Title is required'));
    }

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    const payload = sanitizePayload({
      subcategory_id: subcategoryId,
      title,
      subtitle: subtitle || null,
      content: content || null,
      section_type,
      media_url: media_url || null,
      button_label: button_label || null,
      button_url: button_url || null,
      display_order: parseInt(display_order, 10) || 0,
      is_active: is_active === true || is_active === 'true'
    });

    let data;
    try {
      if (sectionId) {
        const result = await prisma.subcategory_sections.updateMany({
          where: { id: sectionId, subcategory_id: subcategoryId },
          data: { ...payload, updated_by: req.user?.id || null }
        });
        if (result.count === 0) {
          logger.error('Upsert section error: no matching row for', { sectionId, subcategoryId });
          return res.status(500).json(formatError('Failed to save section'));
        }
        data = await prisma.subcategory_sections.findUnique({ where: { id: sectionId } });
      } else {
        data = await prisma.subcategory_sections.create({
          data: { ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null }
        });
      }
    } catch (error) {
      logger.error('Upsert section error:', error);
      return res.status(500).json(formatError('Failed to save section'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Upsert section exception:', error);
    return res.status(500).json(formatError('Server error while saving section'));
  }
};

const deleteSection = async (req, res) => {
  try {
    const { subcategoryId, sectionId } = req.params;

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    try {
      await prisma.subcategory_sections.deleteMany({ where: { id: sectionId, subcategory_id: subcategoryId } });
    } catch (error) {
      logger.error('Delete section error:', error);
      return res.status(500).json(formatError('Failed to delete section'));
    }

    return res.json({ success: true, message: 'Section deleted successfully' });
  } catch (error) {
    logger.error('Delete section exception:', error);
    return res.status(500).json(formatError('Server error while deleting section'));
  }
};

const getTables = async (req, res) => {
  try {
    const { subcategoryId } = req.params;

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    let data;
    try {
      data = await prisma.subcategory_tables.findMany({
        where: { subcategory_id: subcategoryId },
        select: {
          id: true, title: true, description: true, display_order: true, is_active: true,
          created_at: true, updated_at: true,
          subcategory_table_rows: { select: { id: true, row_data: true, display_order: true } }
        },
        orderBy: { display_order: 'asc' }
      });
    } catch (error) {
      logger.error('Get tables error:', error);
      return res.status(500).json(formatError('Failed to fetch tables'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get tables exception:', error);
    return res.status(500).json(formatError('Server error while fetching tables'));
  }
};

// ⚠️ PRE-EXISTING BUG (preserved faithfully — see MIGRATION_TRACKER.md §4.5e):
// subcategory_tables' real `slug` column (NOT NULL, part of a unique compound index
// with subcategory_id) is never set here. Every create/update has always failed in
// production (confirmed: 0 real rows exist in this table).
const upsertTable = async (req, res) => {
  try {
    const { subcategoryId, tableId } = req.params;
    const {
      title,
      description,
      column_headers,
      display_order = 0,
      is_active = true,
      rows = []
    } = req.body;

    if (!title) {
      return res.status(400).json(formatError('Title is required'));
    }

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    const payload = sanitizePayload({
      subcategory_id: subcategoryId,
      title,
      description: description || null,
      column_headers: column_headers || null,
      display_order: parseInt(display_order, 10) || 0,
      is_active: is_active === true || is_active === 'true'
    });

    let savedTableId;
    try {
      if (tableId) {
        const result = await prisma.subcategory_tables.updateMany({
          where: { id: tableId, subcategory_id: subcategoryId },
          data: { ...payload, updated_by: req.user?.id || null }
        });
        if (result.count === 0) {
          logger.error('Upsert table error: no matching row for', { tableId, subcategoryId });
          return res.status(500).json(formatError('Failed to save table'));
        }
        savedTableId = tableId;
      } else {
        const created = await prisma.subcategory_tables.create({
          data: { ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null },
          select: { id: true }
        });
        savedTableId = created.id;
      }
    } catch (error) {
      logger.error('Upsert table error:', error);
      return res.status(500).json(formatError('Failed to save table'));
    }

    if (Array.isArray(rows)) {
      await prisma.subcategory_table_rows.deleteMany({ where: { table_id: savedTableId } });

      if (rows.length) {
        const rowPayload = rows.map((row, index) => ({
          table_id: savedTableId,
          row_data: row.row_data || row,
          display_order: row.display_order ?? index
        }));
        await prisma.subcategory_table_rows.createMany({ data: rowPayload });
      }
    }

    return getTables(req, res);
  } catch (error) {
    logger.error('Upsert table exception:', error);
    return res.status(500).json(formatError('Server error while saving table'));
  }
};

const deleteTable = async (req, res) => {
  try {
    const { subcategoryId, tableId } = req.params;

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    try {
      await prisma.subcategory_tables.deleteMany({ where: { id: tableId, subcategory_id: subcategoryId } });
    } catch (error) {
      logger.error('Delete table error:', error);
      return res.status(500).json(formatError('Failed to delete table'));
    }

    return res.json({ success: true, message: 'Table deleted successfully' });
  } catch (error) {
    logger.error('Delete table exception:', error);
    return res.status(500).json(formatError('Server error while deleting table'));
  }
};

const getQuestionPapers = async (req, res) => {
  try {
    const { subcategoryId } = req.params;
    const { page, limit, offset } = parsePagination(req.query);

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    let rows, count;
    try {
      [rows, count] = await Promise.all([
        prisma.subcategory_question_papers.findMany({
          where: { subcategory_id: subcategoryId },
          include: {
            exams: {
              select: {
                id: true, title: true, slug: true, url_path: true, total_questions: true,
                duration: true, total_marks: true, difficulty: true, is_free: true,
                logo_url: true, thumbnail_url: true, supports_hindi: true
              }
            }
          },
          orderBy: [{ year: 'desc' }, { display_order: 'asc' }],
          skip: offset,
          take: limit
        }),
        prisma.subcategory_question_papers.count({ where: { subcategory_id: subcategoryId } })
      ]);
    } catch (error) {
      logger.error('Get question papers error:', error);
      return res.status(500).json(formatError('Failed to fetch question papers'));
    }

    const data = rows.map(({ exams, ...rest }) => ({ ...rest, exam: exams }));

    return res.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: count ? Math.ceil(count / limit) : 0
      }
    });
  } catch (error) {
    logger.error('Get question papers exception:', error);
    return res.status(500).json(formatError('Server error while fetching question papers'));
  }
};

const upsertQuestionPaper = async (req, res) => {
  try {
    const { subcategoryId, paperId } = req.params;
    const {
      exam_id,
      title,
      year,
      shift,
      language,
      paper_type,
      file_url,
      download_url,
      description,
      display_order = 0,
      is_active = true
    } = req.body;

    if (!exam_id && !title) {
      return res.status(400).json(formatError('Either exam_id or title is required'));
    }

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    if (exam_id) {
      const exam = await prisma.exams.findUnique({ where: { id: exam_id }, select: { id: true } });
      if (!exam) {
        return res.status(404).json(formatError('Exam not found'));
      }
    }

    const payload = sanitizePayload({
      subcategory_id: subcategoryId,
      exam_id: exam_id || null,
      title: title || null,
      // year is a VARCHAR(10) column, not numeric — PostgREST silently accepted a JS
      // number here via implicit Postgres casting, but Prisma's client is stricter and
      // rejects a number for a String field outright. Keep it a string; this is a type
      // adaptation for the stricter client, not a business-logic change.
      year: year ? String(year) : null,
      shift: shift || null,
      language: language || null,
      paper_type: paper_type || null,
      file_url: file_url || null,
      download_url: download_url || null,
      description: description || null,
      display_order: parseInt(display_order, 10) || 0,
      is_active: is_active === true || is_active === 'true'
    });

    let data;
    try {
      if (paperId) {
        const result = await prisma.subcategory_question_papers.updateMany({
          where: { id: paperId, subcategory_id: subcategoryId },
          data: { ...payload, updated_by: req.user?.id || null }
        });
        if (result.count === 0) {
          logger.error('Upsert question paper error: no matching row for', { paperId, subcategoryId });
          return res.status(500).json(formatError('Failed to save question paper'));
        }
        data = await prisma.subcategory_question_papers.findUnique({ where: { id: paperId } });
      } else {
        data = await prisma.subcategory_question_papers.create({
          data: { ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null }
        });
      }
    } catch (error) {
      logger.error('Upsert question paper error:', error);
      return res.status(500).json(formatError('Failed to save question paper'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Upsert question paper exception:', error);
    return res.status(500).json(formatError('Server error while saving question paper'));
  }
};

const deleteQuestionPaper = async (req, res) => {
  try {
    const { subcategoryId, paperId } = req.params;

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    try {
      await prisma.subcategory_question_papers.deleteMany({ where: { id: paperId, subcategory_id: subcategoryId } });
    } catch (error) {
      logger.error('Delete question paper error:', error);
      return res.status(500).json(formatError('Failed to delete question paper'));
    }

    return res.json({ success: true, message: 'Question paper deleted successfully' });
  } catch (error) {
    logger.error('Delete question paper exception:', error);
    return res.status(500).json(formatError('Server error while deleting question paper'));
  }
};

const getFAQs = async (req, res) => {
  try {
    const { subcategoryId } = req.params;

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    let data;
    try {
      data = await prisma.subcategory_faqs.findMany({
        where: { subcategory_id: subcategoryId },
        orderBy: { display_order: 'asc' }
      });
    } catch (error) {
      logger.error('Get FAQs error:', error);
      return res.status(500).json(formatError('Failed to fetch FAQs'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get FAQs exception:', error);
    return res.status(500).json(formatError('Server error while fetching FAQs'));
  }
};

// ⚠️ PRE-EXISTING BUG (preserved faithfully — see MIGRATION_TRACKER.md §4.5e):
// subcategory_faqs has no `faq_category` column. Every create/update has always failed
// in production (confirmed: 0 real rows exist in this table).
const upsertFAQ = async (req, res) => {
  try {
    const { subcategoryId, faqId } = req.params;
    const {
      question,
      answer,
      faq_category,
      display_order = 0,
      is_active = true
    } = req.body;

    if (!question || !answer) {
      return res.status(400).json(formatError('Question and answer are required'));
    }

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    const payload = sanitizePayload({
      subcategory_id: subcategoryId,
      question,
      answer,
      faq_category: faq_category || null,
      display_order: parseInt(display_order, 10) || 0,
      is_active: is_active === true || is_active === 'true'
    });

    let data;
    try {
      if (faqId) {
        const result = await prisma.subcategory_faqs.updateMany({
          where: { id: faqId, subcategory_id: subcategoryId },
          data: { ...payload, updated_by: req.user?.id || null }
        });
        if (result.count === 0) {
          logger.error('Upsert FAQ error: no matching row for', { faqId, subcategoryId });
          return res.status(500).json(formatError('Failed to save FAQ'));
        }
        data = await prisma.subcategory_faqs.findUnique({ where: { id: faqId } });
      } else {
        data = await prisma.subcategory_faqs.create({
          data: { ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null }
        });
      }
    } catch (error) {
      logger.error('Upsert FAQ error:', error);
      return res.status(500).json(formatError('Failed to save FAQ'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Upsert FAQ exception:', error);
    return res.status(500).json(formatError('Server error while saving FAQ'));
  }
};

const deleteFAQ = async (req, res) => {
  try {
    const { subcategoryId, faqId } = req.params;

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    try {
      await prisma.subcategory_faqs.deleteMany({ where: { id: faqId, subcategory_id: subcategoryId } });
    } catch (error) {
      logger.error('Delete FAQ error:', error);
      return res.status(500).json(formatError('Failed to delete FAQ'));
    }

    return res.json({ success: true, message: 'FAQ deleted successfully' });
  } catch (error) {
    logger.error('Delete FAQ exception:', error);
    return res.status(500).json(formatError('Server error while deleting FAQ'));
  }
};

const getResources = async (req, res) => {
  try {
    const { subcategoryId } = req.params;

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    let data;
    try {
      data = await prisma.subcategory_resources.findMany({
        where: { subcategory_id: subcategoryId },
        orderBy: { display_order: 'asc' }
      });
    } catch (error) {
      logger.error('Get resources error:', error);
      return res.status(500).json(formatError('Failed to fetch resources'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get resources exception:', error);
    return res.status(500).json(formatError('Server error while fetching resources'));
  }
};

// ⚠️ PRE-EXISTING BUG (preserved faithfully — see MIGRATION_TRACKER.md §4.5e):
// subcategory_resources' real columns are `label`/`link_url` (both NOT NULL), not
// `title`/`resource_url` — and `resource_type`/`thumbnail_url`/`is_active` don't exist
// on this table at all. Every create/update has always failed in production (confirmed:
// 0 real rows exist in this table).
const upsertResource = async (req, res) => {
  try {
    const { subcategoryId, resourceId } = req.params;
    const {
      title,
      description,
      resource_type,
      resource_url,
      thumbnail_url,
      display_order = 0,
      is_active = true
    } = req.body;

    if (!title || !resource_type) {
      return res.status(400).json(formatError('Title and resource type are required'));
    }

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    const payload = sanitizePayload({
      subcategory_id: subcategoryId,
      title,
      description: description || null,
      resource_type,
      resource_url: resource_url || null,
      thumbnail_url: thumbnail_url || null,
      display_order: parseInt(display_order, 10) || 0,
      is_active: is_active === true || is_active === 'true'
    });

    let data;
    try {
      if (resourceId) {
        const result = await prisma.subcategory_resources.updateMany({
          where: { id: resourceId, subcategory_id: subcategoryId },
          data: { ...payload, updated_by: req.user?.id || null }
        });
        if (result.count === 0) {
          logger.error('Upsert resource error: no matching row for', { resourceId, subcategoryId });
          return res.status(500).json(formatError('Failed to save resource'));
        }
        data = await prisma.subcategory_resources.findUnique({ where: { id: resourceId } });
      } else {
        data = await prisma.subcategory_resources.create({
          data: { ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null }
        });
      }
    } catch (error) {
      logger.error('Upsert resource error:', error);
      return res.status(500).json(formatError('Failed to save resource'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Upsert resource exception:', error);
    return res.status(500).json(formatError('Server error while saving resource'));
  }
};

const deleteResource = async (req, res) => {
  try {
    const { subcategoryId, resourceId } = req.params;

    if (!(await verifySubcategory(subcategoryId))) {
      return res.status(404).json(formatError('Subcategory not found'));
    }

    try {
      await prisma.subcategory_resources.deleteMany({ where: { id: resourceId, subcategory_id: subcategoryId } });
    } catch (error) {
      logger.error('Delete resource error:', error);
      return res.status(500).json(formatError('Failed to delete resource'));
    }

    return res.json({ success: true, message: 'Resource deleted successfully' });
  } catch (error) {
    logger.error('Delete resource exception:', error);
    return res.status(500).json(formatError('Server error while deleting resource'));
  }
};

module.exports = {
  uploadHeroImage,
  getOverview,
  upsertOverview,
  getUpdates,
  upsertUpdate,
  deleteUpdate,
  getHighlights,
  upsertHighlight,
  deleteHighlight,
  getExamStats,
  upsertExamStat,
  deleteExamStat,
  getSections,
  upsertSection,
  deleteSection,
  getTables,
  upsertTable,
  deleteTable,
  getQuestionPapers,
  upsertQuestionPaper,
  deleteQuestionPaper,
  getFAQs,
  upsertFAQ,
  deleteFAQ,
  getResources,
  upsertResource,
  deleteResource
};
