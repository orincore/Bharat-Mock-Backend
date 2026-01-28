const supabase = require('../config/database');
const logger = require('../config/logger');

const parsePagination = (query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  return { page, limit, offset: (page - 1) * limit };
};

const verifyCategory = async (categoryId) => {
  const { data: category } = await supabase
    .from('exam_categories')
    .select('id')
    .eq('id', categoryId)
    .single();
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

const getNotifications = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { page, limit, offset } = parsePagination(req.query);

    if (!(await verifyCategory(categoryId))) {
      return res.status(404).json(formatError('Category not found'));
    }

    const baseQuery = supabase
      .from('category_notifications')
      .select('*', { count: 'exact' })
      .eq('category_id', categoryId)
      .order('notification_date', { ascending: false })
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await baseQuery;

    if (error) {
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
      notification_date,
      link_url: link_url || null,
      is_active: is_active === true || is_active === 'true',
      display_order: parseInt(display_order, 10) || 0,
      created_by: req.user?.id || null,
      updated_by: req.user?.id || null
    };

    const { data, error } = await supabase
      .from('category_notifications')
      .insert(payload)
      .select()
      .single();

    if (error) {
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
      notification_date,
      link_url,
      updated_by: req.user?.id || null
    });

    if (is_active !== undefined) {
      updateData.is_active = is_active === true || is_active === 'true';
    }

    if (display_order !== undefined) {
      updateData.display_order = parseInt(display_order, 10) || 0;
    }

    const { data, error } = await supabase
      .from('category_notifications')
      .update(updateData)
      .eq('id', notificationId)
      .eq('category_id', categoryId)
      .select()
      .single();

    if (error || !data) {
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

    const { error } = await supabase
      .from('category_notifications')
      .delete()
      .eq('id', notificationId)
      .eq('category_id', categoryId);

    if (error) {
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

    const { data, error } = await supabase
      .from('category_syllabus')
      .select('id, subject_name, description, display_order, is_active, created_at, updated_at, category_syllabus_topics(id, topic_name, display_order)')
      .eq('category_id', categoryId)
      .order('display_order', { ascending: true });

    if (error) {
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

    let response;
    if (syllabusId) {
      response = await supabase
        .from('category_syllabus')
        .update({ ...payload, updated_by: req.user?.id || null })
        .eq('id', syllabusId)
        .eq('category_id', categoryId)
        .select('id')
        .single();
    } else {
      response = await supabase
        .from('category_syllabus')
        .insert({ ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null })
        .select('id')
        .single();
    }

    if (response.error) {
      logger.error('Upsert syllabus error:', response.error);
      return res.status(500).json(formatError('Failed to save syllabus section'));
    }

    const sectionId = response.data.id;

    if (Array.isArray(topics)) {
      await supabase
        .from('category_syllabus_topics')
        .delete()
        .eq('syllabus_id', sectionId);

      if (topics.length) {
        const topicPayload = topics.map((topic, index) => ({
          syllabus_id: sectionId,
          topic_name: typeof topic === 'string' ? topic : topic.topic_name,
          display_order: topic.display_order ?? index
        }));
        await supabase.from('category_syllabus_topics').insert(topicPayload);
      }
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

    const { error } = await supabase
      .from('category_syllabus')
      .delete()
      .eq('id', syllabusId)
      .eq('category_id', categoryId);

    if (error) {
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

    const { data, error } = await supabase
      .from('category_cutoffs')
      .select('*')
      .eq('category_id', categoryId)
      .order('year', { ascending: false })
      .order('display_order', { ascending: true });

    if (error) {
      logger.error('Get cutoffs error:', error);
      return res.status(500).json(formatError('Failed to fetch cutoffs'));
    }

    return res.json({ success: true, data });
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

    let response;
    if (cutoffId) {
      response = await supabase
        .from('category_cutoffs')
        .update({ ...payload, updated_by: req.user?.id || null })
        .eq('id', cutoffId)
        .eq('category_id', categoryId)
        .select()
        .single();
    } else {
      response = await supabase
        .from('category_cutoffs')
        .insert({ ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null })
        .select()
        .single();
    }

    if (response.error) {
      logger.error('Upsert cutoff error:', response.error);
      return res.status(500).json(formatError('Failed to save cutoff'));
    }

    return res.json({ success: true, data: response.data });
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

    const { error } = await supabase
      .from('category_cutoffs')
      .delete()
      .eq('id', cutoffId)
      .eq('category_id', categoryId);

    if (error) {
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

    const { data, error } = await supabase
      .from('category_important_dates')
      .select('*')
      .eq('category_id', categoryId)
      .order('event_date', { ascending: true })
      .order('display_order', { ascending: true });

    if (error) {
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
      event_date: event_date || null,
      event_date_text: event_date_text || null,
      description: description || null,
      link_url: link_url || null,
      display_order: parseInt(display_order, 10) || 0,
      is_active: is_active === true || is_active === 'true'
    });

    let response;
    if (dateId) {
      response = await supabase
        .from('category_important_dates')
        .update({ ...payload, updated_by: req.user?.id || null })
        .eq('id', dateId)
        .eq('category_id', categoryId)
        .select()
        .single();
    } else {
      response = await supabase
        .from('category_important_dates')
        .insert({ ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null })
        .select()
        .single();
    }

    if (response.error) {
      logger.error('Upsert important date error:', response.error);
      return res.status(500).json(formatError('Failed to save important date'));
    }

    return res.json({ success: true, data: response.data });
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

    const { error } = await supabase
      .from('category_important_dates')
      .delete()
      .eq('id', dateId)
      .eq('category_id', categoryId);

    if (error) {
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

    const { data, error } = await supabase
      .from('category_preparation_tips')
      .select('*')
      .eq('category_id', categoryId)
      .order('display_order', { ascending: true });

    if (error) {
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

    let response;
    if (tipId) {
      response = await supabase
        .from('category_preparation_tips')
        .update({ ...payload, updated_by: req.user?.id || null })
        .eq('id', tipId)
        .eq('category_id', categoryId)
        .select()
        .single();
    } else {
      response = await supabase
        .from('category_preparation_tips')
        .insert({ ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null })
        .select()
        .single();
    }

    if (response.error) {
      logger.error('Upsert preparation tip error:', response.error);
      return res.status(500).json(formatError('Failed to save preparation tip'));
    }

    return res.json({ success: true, data: response.data });
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

    const { error } = await supabase
      .from('category_preparation_tips')
      .delete()
      .eq('id', tipId)
      .eq('category_id', categoryId);

    if (error) {
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

    const { data, error } = await supabase
      .from('category_articles')
      .select('id, display_order, is_featured, articles(id, title, slug, published_at)')
      .eq('category_id', categoryId)
      .order('display_order', { ascending: true });

    if (error) {
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

    const { data, error } = await supabase
      .from('category_articles')
      .upsert(payload, { onConflict: 'category_id,article_id' })
      .select()
      .single();

    if (error) {
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

    const { error } = await supabase
      .from('category_articles')
      .delete()
      .eq('category_id', categoryId)
      .eq('article_id', articleId);

    if (error) {
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

    const { data, error } = await supabase
      .from('category_custom_sections')
      .select('*')
      .eq('category_id', categoryId)
      .order('display_order', { ascending: true });

    if (error) {
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

    let response;
    if (sectionId) {
      response = await supabase
        .from('category_custom_sections')
        .update({ ...payload, updated_by: req.user?.id || null })
        .eq('id', sectionId)
        .eq('category_id', categoryId)
        .select()
        .single();
    } else {
      response = await supabase
        .from('category_custom_sections')
        .insert({ ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null })
        .select()
        .single();
    }

    if (response.error) {
      logger.error('Upsert custom section error:', response.error);
      return res.status(500).json(formatError('Failed to save custom section'));
    }

    return res.json({ success: true, data: response.data });
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

    const { error } = await supabase
      .from('category_custom_sections')
      .delete()
      .eq('id', sectionId)
      .eq('category_id', categoryId);

    if (error) {
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
