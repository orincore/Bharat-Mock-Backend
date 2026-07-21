const prisma = require('../config/prisma');
const logger = require('../config/logger');

const parsePagination = (query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  return { page, limit, offset: (page - 1) * limit };
};

const verifyCategory = async (categoryId) => {
  const category = await prisma.exam_categories.findUnique({
    where: { id: categoryId },
    select: { id: true }
  });
  return Boolean(category);
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

// category_cutoffs.marks/total_marks are Decimal columns — Prisma returns Decimal.js
// objects that serialize to JSON strings, not plain numbers, unlike supabase-js which
// always returned plain numbers for numeric columns. Convert on the way out so the API
// contract (marks as a JSON number) is unchanged. See MIGRATION_TRACKER.md §4.5.
const normalizeCutoff = (cutoff) => {
  if (!cutoff) return cutoff;
  return {
    ...cutoff,
    marks: cutoff.marks !== null && cutoff.marks !== undefined ? Number(cutoff.marks) : cutoff.marks,
    total_marks: cutoff.total_marks !== null && cutoff.total_marks !== undefined ? Number(cutoff.total_marks) : cutoff.total_marks
  };
};

const getNotifications = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { page, limit, offset } = parsePagination(req.query);

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    let data, count;
    try {
      [data, count] = await Promise.all([
        prisma.category_notifications.findMany({
          where: { category_id: categoryId },
          orderBy: [
            { notification_date: 'desc' },
            { display_order: 'asc' },
            { created_at: 'desc' }
          ],
          skip: offset,
          take: limit
        }),
        prisma.category_notifications.count({ where: { category_id: categoryId } })
      ]);
    } catch (error) {
      logger.error('Get notifications error:', error);
      return res.status(500).json(formatError('Failed to fetch notifications'));
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
    logger.error('Get notifications exception:', error);
    return res.status(500).json(formatError('Server error while fetching notifications'));
  }
};

const createNotification = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const {
      title,
      description,
      notification_type,
      notification_date,
      link_url,
      is_active = true,
      display_order = 0
    } = req.body;

    if (!title || !notification_type || !notification_date) {
      return res.status(400).json(formatError('Title, notification type, and date are required'));
    }

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    const payload = {
      category_id: categoryId,
      title,
      description: description || null,
      notification_type,
      // notification_date is a @db.Date column — Prisma rejects bare "YYYY-MM-DD" strings,
      // needs a real Date object. See MIGRATION_TRACKER.md §4.5.
      notification_date: new Date(notification_date),
      link_url: link_url || null,
      is_active: is_active === true || is_active === 'true',
      display_order: parseInt(display_order, 10) || 0,
      created_by: req.user?.id || null,
      updated_by: req.user?.id || null
    };

    let data;
    try {
      data = await prisma.category_notifications.create({ data: payload });
    } catch (error) {
      logger.error('Create notification error:', error);
      return res.status(500).json(formatError('Failed to create notification'));
    }

    return res.status(201).json({ success: true, data });
  } catch (error) {
    logger.error('Create notification exception:', error);
    return res.status(500).json(formatError('Server error while creating notification'));
  }
};

const updateNotification = async (req, res) => {
  try {
    const { categoryId, notificationId } = req.params;
    const {
      title,
      description,
      notification_type,
      notification_date,
      link_url,
      is_active,
      display_order
    } = req.body;

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    const updateData = sanitizePayload({
      title,
      description,
      notification_type,
      notification_date: notification_date !== undefined ? new Date(notification_date) : undefined,
      link_url,
      updated_by: req.user?.id || null
    });

    if (is_active !== undefined) {
      updateData.is_active = is_active === true || is_active === 'true';
    }

    if (display_order !== undefined) {
      updateData.display_order = parseInt(display_order, 10) || 0;
    }

    let data;
    try {
      // updateMany with a compound {id, category_id} filter — same as the original
      // supabase .eq('id',...).eq('category_id',...) — so a notification belonging to a
      // different category is never touched at all, not written-then-rejected.
      const result = await prisma.category_notifications.updateMany({
        where: { id: notificationId, category_id: categoryId },
        data: updateData
      });
      if (result.count === 0) {
        return res.status(404).json(formatError('Notification not found or failed to update'));
      }
      data = await prisma.category_notifications.findUnique({ where: { id: notificationId } });
    } catch (error) {
      logger.error('Update notification error:', error);
      return res.status(404).json(formatError('Notification not found or failed to update'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Update notification exception:', error);
    return res.status(500).json(formatError('Server error while updating notification'));
  }
};

const deleteNotification = async (req, res) => {
  try {
    const { categoryId, notificationId } = req.params;

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    try {
      await prisma.category_notifications.deleteMany({
        where: { id: notificationId, category_id: categoryId }
      });
    } catch (error) {
      logger.error('Delete notification error:', error);
      return res.status(500).json(formatError('Failed to delete notification'));
    }

    return res.json({ success: true, message: 'Notification deleted successfully' });
  } catch (error) {
    logger.error('Delete notification exception:', error);
    return res.status(500).json(formatError('Server error while deleting notification'));
  }
};

const getSyllabus = async (req, res) => {
  try {
    const { categoryId } = req.params;

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    let data;
    try {
      data = await prisma.category_syllabus.findMany({
        where: { category_id: categoryId },
        select: {
          id: true,
          subject_name: true,
          description: true,
          display_order: true,
          is_active: true,
          created_at: true,
          updated_at: true,
          category_syllabus_topics: {
            select: { id: true, topic_name: true, display_order: true },
            orderBy: { display_order: 'asc' }
          }
        },
        orderBy: { display_order: 'asc' }
      });
    } catch (error) {
      logger.error('Get syllabus error:', error);
      return res.status(500).json(formatError('Failed to fetch syllabus'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get syllabus exception:', error);
    return res.status(500).json(formatError('Server error while fetching syllabus'));
  }
};

const upsertSyllabusSection = async (req, res) => {
  try {
    const { categoryId, syllabusId } = req.params;
    const { subject_name, description, display_order = 0, is_active = true, topics = [] } = req.body;

    if (!subject_name) {
      return res.status(400).json(formatError('Subject name is required'));
    }

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    const payload = {
      category_id: categoryId,
      subject_name,
      description: description || null,
      display_order: parseInt(display_order, 10) || 0,
      is_active: is_active === true || is_active === 'true'
    };

    let sectionId;
    try {
      if (syllabusId) {
        // Compound {id, category_id} filter, same as the original supabase
        // .eq('id',...).eq('category_id',...) — a syllabus section belonging to a
        // different category must never be touched by this call.
        const result = await prisma.category_syllabus.updateMany({
          where: { id: syllabusId, category_id: categoryId },
          data: { ...payload, updated_by: req.user?.id || null }
        });
        if (result.count === 0) {
          // Same outcome as the original's .single() erroring on a 0-row compound-filtered
          // update (wrong category or nonexistent id) — logged and reported the same way.
          logger.error('Upsert syllabus error: no matching row for', { syllabusId, categoryId });
          return res.status(500).json(formatError('Failed to save syllabus section'));
        }
        sectionId = syllabusId;
      } else {
        const created = await prisma.category_syllabus.create({
          data: { ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null },
          select: { id: true }
        });
        sectionId = created.id;
      }
    } catch (error) {
      logger.error('Upsert syllabus error:', error);
      return res.status(500).json(formatError('Failed to save syllabus section'));
    }

    if (Array.isArray(topics)) {
      const topicPayload = topics.map((topic, index) => ({
        syllabus_id: sectionId,
        topic_name: typeof topic === 'string' ? topic : topic.topic_name,
        display_order: topic.display_order ?? index
      }));

      // Delete + recreate is the same replace-all semantics as the original, wrapped in a
      // transaction so a mid-way failure can't leave the syllabus section with no topics.
      await prisma.$transaction([
        prisma.category_syllabus_topics.deleteMany({ where: { syllabus_id: sectionId } }),
        ...(topicPayload.length ? [prisma.category_syllabus_topics.createMany({ data: topicPayload })] : [])
      ]);
    }

    return getSyllabus(req, res);
  } catch (error) {
    logger.error('Upsert syllabus exception:', error);
    return res.status(500).json(formatError('Server error while saving syllabus section'));
  }
};

const deleteSyllabusSection = async (req, res) => {
  try {
    const { categoryId, syllabusId } = req.params;

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    try {
      await prisma.category_syllabus.deleteMany({
        where: { id: syllabusId, category_id: categoryId }
      });
    } catch (error) {
      logger.error('Delete syllabus error:', error);
      return res.status(500).json(formatError('Failed to delete syllabus section'));
    }

    return res.json({ success: true, message: 'Syllabus section deleted successfully' });
  } catch (error) {
    logger.error('Delete syllabus exception:', error);
    return res.status(500).json(formatError('Server error while deleting syllabus section'));
  }
};

const getCutoffs = async (req, res) => {
  try {
    const { categoryId } = req.params;

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    let data;
    try {
      data = await prisma.category_cutoffs.findMany({
        where: { category_id: categoryId },
        orderBy: [{ year: 'desc' }, { display_order: 'asc' }]
      });
    } catch (error) {
      logger.error('Get cutoffs error:', error);
      return res.status(500).json(formatError('Failed to fetch cutoffs'));
    }

    return res.json({ success: true, data: data.map(normalizeCutoff) });
  } catch (error) {
    logger.error('Get cutoffs exception:', error);
    return res.status(500).json(formatError('Server error while fetching cutoffs'));
  }
};

const upsertCutoff = async (req, res) => {
  try {
    const { categoryId, cutoffId } = req.params;
    const { exam_name, year, cutoff_category, marks, total_marks, description, display_order = 0, is_active = true } = req.body;

    if (!year || !cutoff_category || marks === undefined) {
      return res.status(400).json(formatError('Year, category, and marks are required'));
    }

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    const payload = sanitizePayload({
      category_id: categoryId,
      exam_name: exam_name || null,
      year,
      cutoff_category,
      marks: parseFloat(marks),
      total_marks: total_marks !== undefined ? parseFloat(total_marks) : null,
      description: description || null,
      display_order: parseInt(display_order, 10) || 0,
      is_active: is_active === true || is_active === 'true'
    });

    let data;
    try {
      if (cutoffId) {
        // Compound {id, category_id} filter — a cutoff belonging to a different category
        // must never be touched by this call (same guard as the original's compound
        // .eq('id',...).eq('category_id',...)).
        const result = await prisma.category_cutoffs.updateMany({
          where: { id: cutoffId, category_id: categoryId },
          data: { ...payload, updated_by: req.user?.id || null }
        });
        if (result.count === 0) {
          logger.error('Upsert cutoff error: no matching row for', { cutoffId, categoryId });
          return res.status(500).json(formatError('Failed to save cutoff'));
        }
        data = await prisma.category_cutoffs.findUnique({ where: { id: cutoffId } });
      } else {
        data = await prisma.category_cutoffs.create({
          data: { ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null }
        });
      }
    } catch (error) {
      logger.error('Upsert cutoff error:', error);
      return res.status(500).json(formatError('Failed to save cutoff'));
    }

    return res.json({ success: true, data: normalizeCutoff(data) });
  } catch (error) {
    logger.error('Upsert cutoff exception:', error);
    return res.status(500).json(formatError('Server error while saving cutoff'));
  }
};

const deleteCutoff = async (req, res) => {
  try {
    const { categoryId, cutoffId } = req.params;

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    try {
      await prisma.category_cutoffs.deleteMany({
        where: { id: cutoffId, category_id: categoryId }
      });
    } catch (error) {
      logger.error('Delete cutoff error:', error);
      return res.status(500).json(formatError('Failed to delete cutoff'));
    }

    return res.json({ success: true, message: 'Cutoff deleted successfully' });
  } catch (error) {
    logger.error('Delete cutoff exception:', error);
    return res.status(500).json(formatError('Server error while deleting cutoff'));
  }
};

const getImportantDates = async (req, res) => {
  try {
    const { categoryId } = req.params;

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    let data;
    try {
      data = await prisma.category_important_dates.findMany({
        where: { category_id: categoryId },
        orderBy: [{ event_date: 'asc' }, { display_order: 'asc' }]
      });
    } catch (error) {
      logger.error('Get important dates error:', error);
      return res.status(500).json(formatError('Failed to fetch important dates'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get important dates exception:', error);
    return res.status(500).json(formatError('Server error while fetching important dates'));
  }
};

const upsertImportantDate = async (req, res) => {
  try {
    const { categoryId, dateId } = req.params;
    const { event_name, event_date, event_date_text, description, link_url, display_order = 0, is_active = true } = req.body;

    if (!event_name) {
      return res.status(400).json(formatError('Event name is required'));
    }

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    const payload = sanitizePayload({
      category_id: categoryId,
      event_name,
      // event_date is a @db.Date column — same bare-date-string gotcha as
      // notification_date above.
      event_date: event_date ? new Date(event_date) : null,
      event_date_text: event_date_text || null,
      description: description || null,
      link_url: link_url || null,
      display_order: parseInt(display_order, 10) || 0,
      is_active: is_active === true || is_active === 'true'
    });

    let data;
    try {
      if (dateId) {
        const result = await prisma.category_important_dates.updateMany({
          where: { id: dateId, category_id: categoryId },
          data: { ...payload, updated_by: req.user?.id || null }
        });
        if (result.count === 0) {
          logger.error('Upsert important date error: no matching row for', { dateId, categoryId });
          return res.status(500).json(formatError('Failed to save important date'));
        }
        data = await prisma.category_important_dates.findUnique({ where: { id: dateId } });
      } else {
        data = await prisma.category_important_dates.create({
          data: { ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null }
        });
      }
    } catch (error) {
      logger.error('Upsert important date error:', error);
      return res.status(500).json(formatError('Failed to save important date'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Upsert important date exception:', error);
    return res.status(500).json(formatError('Server error while saving important date'));
  }
};

const deleteImportantDate = async (req, res) => {
  try {
    const { categoryId, dateId } = req.params;

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    try {
      await prisma.category_important_dates.deleteMany({
        where: { id: dateId, category_id: categoryId }
      });
    } catch (error) {
      logger.error('Delete important date error:', error);
      return res.status(500).json(formatError('Failed to delete important date'));
    }

    return res.json({ success: true, message: 'Important date deleted successfully' });
  } catch (error) {
    logger.error('Delete important date exception:', error);
    return res.status(500).json(formatError('Server error while deleting important date'));
  }
};

const getPreparationTips = async (req, res) => {
  try {
    const { categoryId } = req.params;

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    let data;
    try {
      data = await prisma.category_preparation_tips.findMany({
        where: { category_id: categoryId },
        orderBy: { display_order: 'asc' }
      });
    } catch (error) {
      logger.error('Get preparation tips error:', error);
      return res.status(500).json(formatError('Failed to fetch preparation tips'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get preparation tips exception:', error);
    return res.status(500).json(formatError('Server error while fetching preparation tips'));
  }
};

const upsertPreparationTip = async (req, res) => {
  try {
    const { categoryId, tipId } = req.params;
    const { title, description, tip_type = 'general', display_order = 0, is_active = true } = req.body;

    if (!title || !description) {
      return res.status(400).json(formatError('Title and description are required'));
    }

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    const payload = sanitizePayload({
      category_id: categoryId,
      title,
      description,
      tip_type,
      display_order: parseInt(display_order, 10) || 0,
      is_active: is_active === true || is_active === 'true'
    });

    let data;
    try {
      if (tipId) {
        const result = await prisma.category_preparation_tips.updateMany({
          where: { id: tipId, category_id: categoryId },
          data: { ...payload, updated_by: req.user?.id || null }
        });
        if (result.count === 0) {
          logger.error('Upsert preparation tip error: no matching row for', { tipId, categoryId });
          return res.status(500).json(formatError('Failed to save preparation tip'));
        }
        data = await prisma.category_preparation_tips.findUnique({ where: { id: tipId } });
      } else {
        data = await prisma.category_preparation_tips.create({
          data: { ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null }
        });
      }
    } catch (error) {
      logger.error('Upsert preparation tip error:', error);
      return res.status(500).json(formatError('Failed to save preparation tip'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Upsert preparation tip exception:', error);
    return res.status(500).json(formatError('Server error while saving preparation tip'));
  }
};

const deletePreparationTip = async (req, res) => {
  try {
    const { categoryId, tipId } = req.params;

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    try {
      await prisma.category_preparation_tips.deleteMany({
        where: { id: tipId, category_id: categoryId }
      });
    } catch (error) {
      logger.error('Delete preparation tip error:', error);
      return res.status(500).json(formatError('Failed to delete preparation tip'));
    }

    return res.json({ success: true, message: 'Preparation tip deleted successfully' });
  } catch (error) {
    logger.error('Delete preparation tip exception:', error);
    return res.status(500).json(formatError('Server error while deleting preparation tip'));
  }
};

const getArticles = async (req, res) => {
  try {
    const { categoryId } = req.params;

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    let data;
    try {
      data = await prisma.category_articles.findMany({
        where: { category_id: categoryId },
        select: {
          id: true,
          display_order: true,
          is_featured: true,
          articles: { select: { id: true, title: true, slug: true, published_at: true } }
        },
        orderBy: { display_order: 'asc' }
      });
    } catch (error) {
      logger.error('Get category articles error:', error);
      return res.status(500).json(formatError('Failed to fetch category articles'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get category articles exception:', error);
    return res.status(500).json(formatError('Server error while fetching category articles'));
  }
};

const linkArticle = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { article_id, display_order = 0, is_featured = false } = req.body;

    if (!article_id) {
      return res.status(400).json(formatError('Article ID is required'));
    }

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    const payload = {
      category_id: categoryId,
      article_id,
      display_order: parseInt(display_order, 10) || 0,
      is_featured: is_featured === true || is_featured === 'true'
    };

    let data;
    try {
      data = await prisma.category_articles.upsert({
        where: { category_id_article_id: { category_id: categoryId, article_id } },
        create: payload,
        update: payload
      });
    } catch (error) {
      logger.error('Link article error:', error);
      return res.status(500).json(formatError('Failed to link article'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Link article exception:', error);
    return res.status(500).json(formatError('Server error while linking article'));
  }
};

const unlinkArticle = async (req, res) => {
  try {
    const { categoryId, articleId } = req.params;

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    try {
      await prisma.category_articles.deleteMany({
        where: { category_id: categoryId, article_id: articleId }
      });
    } catch (error) {
      logger.error('Unlink article error:', error);
      return res.status(500).json(formatError('Failed to unlink article'));
    }

    return res.json({ success: true, message: 'Article unlinked successfully' });
  } catch (error) {
    logger.error('Unlink article exception:', error);
    return res.status(500).json(formatError('Server error while unlinking article'));
  }
};

const getCustomSections = async (req, res) => {
  try {
    const { categoryId } = req.params;

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    let data;
    try {
      data = await prisma.category_custom_sections.findMany({
        where: { category_id: categoryId },
        orderBy: { display_order: 'asc' }
      });
    } catch (error) {
      logger.error('Get custom sections error:', error);
      return res.status(500).json(formatError('Failed to fetch custom sections'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get custom sections exception:', error);
    return res.status(500).json(formatError('Server error while fetching custom sections'));
  }
};

const upsertCustomSection = async (req, res) => {
  try {
    const { categoryId, sectionId } = req.params;
    const {
      title,
      subtitle,
      content,
      media_url,
      layout_type = 'default',
      icon,
      button_label,
      button_url,
      display_order = 0,
      is_active = true
    } = req.body;

    if (!title) {
      return res.status(400).json(formatError('Title is required'));
    }

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    const payload = sanitizePayload({
      category_id: categoryId,
      title,
      subtitle: subtitle || null,
      content: content || null,
      media_url: media_url || null,
      layout_type,
      icon: icon || null,
      button_label: button_label || null,
      button_url: button_url || null,
      display_order: parseInt(display_order, 10) || 0,
      is_active: is_active === true || is_active === 'true'
    });

    let data;
    try {
      if (sectionId) {
        const result = await prisma.category_custom_sections.updateMany({
          where: { id: sectionId, category_id: categoryId },
          data: { ...payload, updated_by: req.user?.id || null }
        });
        if (result.count === 0) {
          logger.error('Upsert custom section error: no matching row for', { sectionId, categoryId });
          return res.status(500).json(formatError('Failed to save custom section'));
        }
        data = await prisma.category_custom_sections.findUnique({ where: { id: sectionId } });
      } else {
        data = await prisma.category_custom_sections.create({
          data: { ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null }
        });
      }
    } catch (error) {
      logger.error('Upsert custom section error:', error);
      return res.status(500).json(formatError('Failed to save custom section'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Upsert custom section exception:', error);
    return res.status(500).json(formatError('Server error while saving custom section'));
  }
};

const deleteCustomSection = async (req, res) => {
  try {
    const { categoryId, sectionId } = req.params;

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    try {
      await prisma.category_custom_sections.deleteMany({
        where: { id: sectionId, category_id: categoryId }
      });
    } catch (error) {
      logger.error('Delete custom section error:', error);
      return res.status(500).json(formatError('Failed to delete custom section'));
    }

    return res.json({ success: true, message: 'Custom section deleted successfully' });
  } catch (error) {
    logger.error('Delete custom section exception:', error);
    return res.status(500).json(formatError('Server error while deleting custom section'));
  }
};

module.exports = {
  getNotifications,
  createNotification,
  updateNotification,
  deleteNotification,
  getSyllabus,
  upsertSyllabusSection,
  deleteSyllabusSection,
  getCutoffs,
  upsertCutoff,
  deleteCutoff,
  getImportantDates,
  upsertImportantDate,
  deleteImportantDate,
  getPreparationTips,
  upsertPreparationTip,
  deletePreparationTip,
  getArticles,
  linkArticle,
  unlinkArticle,
  getCustomSections,
  upsertCustomSection,
  deleteCustomSection
};
