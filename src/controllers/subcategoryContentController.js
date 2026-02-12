const supabase = require('../config/database');
const logger = require('../config/logger');
const { uploadToR2, deleteFromR2 } = require('../utils/fileUpload');
const { R2_PUBLIC_URL } = require('../config/r2');

const parsePagination = (query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  return { page, limit, offset: (page - 1) * limit };
};

const verifySubcategory = async (subcategoryId) => {
  const { data: subcategory } = await supabase
    .from('exam_subcategories')
    .select('id')
    .eq('id', subcategoryId)
    .single();
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

    const { data: overview, error: overviewError } = await supabase
      .from('subcategory_overviews')
      .select('id, hero_image_url')
      .eq('subcategory_id', subcategoryId)
      .maybeSingle();

    if (overviewError && overviewError.code !== 'PGRST116') {
      logger.error('Fetch overview for hero upload error:', overviewError);
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

    let dbResponse;
    if (overview?.id) {
      dbResponse = await supabase
        .from('subcategory_overviews')
        .update(payload)
        .eq('id', overview.id)
        .select('hero_image_url')
        .single();
    } else {
      dbResponse = await supabase
        .from('subcategory_overviews')
        .insert({ ...payload, created_by: req.user?.id || null })
        .select('hero_image_url')
        .single();
    }

    if (dbResponse.error) {
      logger.error('Save hero image url error:', dbResponse.error);
      return res.status(500).json(formatError('Failed to save hero image url'));
    }

    return res.json({
      success: true,
      data: {
        hero_image_url: dbResponse.data.hero_image_url
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

    const { data, error } = await supabase
      .from('subcategory_overviews')
      .select('*')
      .eq('subcategory_id', subcategoryId)
      .single();

    if (error && error.code !== 'PGRST116') {
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

    const { data: existing } = await supabase
      .from('subcategory_overviews')
      .select('id')
      .eq('subcategory_id', subcategoryId)
      .single();

    let response;
    if (existing) {
      response = await supabase
        .from('subcategory_overviews')
        .update(payload)
        .eq('subcategory_id', subcategoryId)
        .select()
        .single();
    } else {
      response = await supabase
        .from('subcategory_overviews')
        .insert({ ...payload, created_by: req.user?.id || null })
        .select()
        .single();
    }

    if (response.error) {
      logger.error('Upsert overview error:', response.error);
      return res.status(500).json(formatError('Failed to save overview'));
    }

    return res.json({ success: true, data: response.data });
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

    const { data, error, count } = await supabase
      .from('subcategory_updates')
      .select('*', { count: 'exact' })
      .eq('subcategory_id', subcategoryId)
      .order('update_date', { ascending: false })
      .order('display_order', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
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
      update_date,
      link_url: link_url || null,
      is_active: is_active === true || is_active === 'true',
      display_order: parseInt(display_order, 10) || 0
    });

    let response;
    if (updateId) {
      response = await supabase
        .from('subcategory_updates')
        .update({ ...payload, updated_by: req.user?.id || null })
        .eq('id', updateId)
        .eq('subcategory_id', subcategoryId)
        .select()
        .single();
    } else {
      response = await supabase
        .from('subcategory_updates')
        .insert({ ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null })
        .select()
        .single();
    }

    if (response.error) {
      logger.error('Upsert update error:', response.error);
      return res.status(500).json(formatError('Failed to save update'));
    }

    return res.json({ success: true, data: response.data });
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

    const { error } = await supabase
      .from('subcategory_updates')
      .delete()
      .eq('id', updateId)
      .eq('subcategory_id', subcategoryId);

    if (error) {
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

    const { data, error } = await supabase
      .from('subcategory_highlights')
      .select('*')
      .eq('subcategory_id', subcategoryId)
      .order('display_order', { ascending: true });

    if (error) {
      logger.error('Get highlights error:', error);
      return res.status(500).json(formatError('Failed to fetch highlights'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get highlights exception:', error);
    return res.status(500).json(formatError('Server error while fetching highlights'));
  }
};

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

    let response;
    if (highlightId) {
      response = await supabase
        .from('subcategory_highlights')
        .update({ ...payload, updated_by: req.user?.id || null })
        .eq('id', highlightId)
        .eq('subcategory_id', subcategoryId)
        .select()
        .single();
    } else {
      response = await supabase
        .from('subcategory_highlights')
        .insert({ ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null })
        .select()
        .single();
    }

    if (response.error) {
      logger.error('Upsert highlight error:', response.error);
      return res.status(500).json(formatError('Failed to save highlight'));
    }

    return res.json({ success: true, data: response.data });
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

    const { error } = await supabase
      .from('subcategory_highlights')
      .delete()
      .eq('id', highlightId)
      .eq('subcategory_id', subcategoryId);

    if (error) {
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

    const { data, error } = await supabase
      .from('subcategory_exam_stats')
      .select('*')
      .eq('subcategory_id', subcategoryId)
      .order('display_order', { ascending: true });

    if (error) {
      logger.error('Get exam stats error:', error);
      return res.status(500).json(formatError('Failed to fetch exam stats'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get exam stats exception:', error);
    return res.status(500).json(formatError('Server error while fetching exam stats'));
  }
};

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

    let response;
    if (statId) {
      response = await supabase
        .from('subcategory_exam_stats')
        .update({ ...payload, updated_by: req.user?.id || null })
        .eq('id', statId)
        .eq('subcategory_id', subcategoryId)
        .select()
        .single();
    } else {
      response = await supabase
        .from('subcategory_exam_stats')
        .insert({ ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null })
        .select()
        .single();
    }

    if (response.error) {
      logger.error('Upsert exam stat error:', response.error);
      return res.status(500).json(formatError('Failed to save exam stat'));
    }

    return res.json({ success: true, data: response.data });
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

    const { error } = await supabase
      .from('subcategory_exam_stats')
      .delete()
      .eq('id', statId)
      .eq('subcategory_id', subcategoryId);

    if (error) {
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

    const { data, error } = await supabase
      .from('subcategory_sections')
      .select('*')
      .eq('subcategory_id', subcategoryId)
      .order('display_order', { ascending: true });

    if (error) {
      logger.error('Get sections error:', error);
      return res.status(500).json(formatError('Failed to fetch sections'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get sections exception:', error);
    return res.status(500).json(formatError('Server error while fetching sections'));
  }
};

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

    let response;
    if (sectionId) {
      response = await supabase
        .from('subcategory_sections')
        .update({ ...payload, updated_by: req.user?.id || null })
        .eq('id', sectionId)
        .eq('subcategory_id', subcategoryId)
        .select()
        .single();
    } else {
      response = await supabase
        .from('subcategory_sections')
        .insert({ ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null })
        .select()
        .single();
    }

    if (response.error) {
      logger.error('Upsert section error:', response.error);
      return res.status(500).json(formatError('Failed to save section'));
    }

    return res.json({ success: true, data: response.data });
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

    const { error } = await supabase
      .from('subcategory_sections')
      .delete()
      .eq('id', sectionId)
      .eq('subcategory_id', subcategoryId);

    if (error) {
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

    const { data, error } = await supabase
      .from('subcategory_tables')
      .select('id, title, description, display_order, is_active, created_at, updated_at, subcategory_table_rows(id, row_data, display_order)')
      .eq('subcategory_id', subcategoryId)
      .order('display_order', { ascending: true });

    if (error) {
      logger.error('Get tables error:', error);
      return res.status(500).json(formatError('Failed to fetch tables'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get tables exception:', error);
    return res.status(500).json(formatError('Server error while fetching tables'));
  }
};

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

    let response;
    if (tableId) {
      response = await supabase
        .from('subcategory_tables')
        .update({ ...payload, updated_by: req.user?.id || null })
        .eq('id', tableId)
        .eq('subcategory_id', subcategoryId)
        .select('id')
        .single();
    } else {
      response = await supabase
        .from('subcategory_tables')
        .insert({ ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null })
        .select('id')
        .single();
    }

    if (response.error) {
      logger.error('Upsert table error:', response.error);
      return res.status(500).json(formatError('Failed to save table'));
    }

    const savedTableId = response.data.id;

    if (Array.isArray(rows)) {
      await supabase
        .from('subcategory_table_rows')
        .delete()
        .eq('table_id', savedTableId);

      if (rows.length) {
        const rowPayload = rows.map((row, index) => ({
          table_id: savedTableId,
          row_data: row.row_data || row,
          display_order: row.display_order ?? index
        }));
        await supabase.from('subcategory_table_rows').insert(rowPayload);
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

    const { error } = await supabase
      .from('subcategory_tables')
      .delete()
      .eq('id', tableId)
      .eq('subcategory_id', subcategoryId);

    if (error) {
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

    const { data, error, count } = await supabase
      .from('subcategory_question_papers')
      .select(`
        *,
        exam:exams(id, title, slug, url_path, total_questions, duration, total_marks, difficulty, is_free, logo_url, thumbnail_url, supports_hindi)
      `, { count: 'exact' })
      .eq('subcategory_id', subcategoryId)
      .order('year', { ascending: false })
      .order('display_order', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Get question papers error:', error);
      return res.status(500).json(formatError('Failed to fetch question papers'));
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
      const { data: exam } = await supabase
        .from('exams')
        .select('id')
        .eq('id', exam_id)
        .single();
      
      if (!exam) {
        return res.status(404).json(formatError('Exam not found'));
      }
    }

    const payload = sanitizePayload({
      subcategory_id: subcategoryId,
      exam_id: exam_id || null,
      title: title || null,
      year: year ? parseInt(year, 10) : null,
      shift: shift || null,
      language: language || null,
      paper_type: paper_type || null,
      file_url: file_url || null,
      download_url: download_url || null,
      description: description || null,
      display_order: parseInt(display_order, 10) || 0,
      is_active: is_active === true || is_active === 'true'
    });

    let response;
    if (paperId) {
      response = await supabase
        .from('subcategory_question_papers')
        .update({ ...payload, updated_by: req.user?.id || null })
        .eq('id', paperId)
        .eq('subcategory_id', subcategoryId)
        .select()
        .single();
    } else {
      response = await supabase
        .from('subcategory_question_papers')
        .insert({ ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null })
        .select()
        .single();
    }

    if (response.error) {
      logger.error('Upsert question paper error:', response.error);
      return res.status(500).json(formatError('Failed to save question paper'));
    }

    return res.json({ success: true, data: response.data });
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

    const { error } = await supabase
      .from('subcategory_question_papers')
      .delete()
      .eq('id', paperId)
      .eq('subcategory_id', subcategoryId);

    if (error) {
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

    const { data, error } = await supabase
      .from('subcategory_faqs')
      .select('*')
      .eq('subcategory_id', subcategoryId)
      .order('display_order', { ascending: true });

    if (error) {
      logger.error('Get FAQs error:', error);
      return res.status(500).json(formatError('Failed to fetch FAQs'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get FAQs exception:', error);
    return res.status(500).json(formatError('Server error while fetching FAQs'));
  }
};

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

    let response;
    if (faqId) {
      response = await supabase
        .from('subcategory_faqs')
        .update({ ...payload, updated_by: req.user?.id || null })
        .eq('id', faqId)
        .eq('subcategory_id', subcategoryId)
        .select()
        .single();
    } else {
      response = await supabase
        .from('subcategory_faqs')
        .insert({ ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null })
        .select()
        .single();
    }

    if (response.error) {
      logger.error('Upsert FAQ error:', response.error);
      return res.status(500).json(formatError('Failed to save FAQ'));
    }

    return res.json({ success: true, data: response.data });
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

    const { error } = await supabase
      .from('subcategory_faqs')
      .delete()
      .eq('id', faqId)
      .eq('subcategory_id', subcategoryId);

    if (error) {
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

    const { data, error } = await supabase
      .from('subcategory_resources')
      .select('*')
      .eq('subcategory_id', subcategoryId)
      .order('display_order', { ascending: true });

    if (error) {
      logger.error('Get resources error:', error);
      return res.status(500).json(formatError('Failed to fetch resources'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get resources exception:', error);
    return res.status(500).json(formatError('Server error while fetching resources'));
  }
};

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

    let response;
    if (resourceId) {
      response = await supabase
        .from('subcategory_resources')
        .update({ ...payload, updated_by: req.user?.id || null })
        .eq('id', resourceId)
        .eq('subcategory_id', subcategoryId)
        .select()
        .single();
    } else {
      response = await supabase
        .from('subcategory_resources')
        .insert({ ...payload, created_by: req.user?.id || null, updated_by: req.user?.id || null })
        .select()
        .single();
    }

    if (response.error) {
      logger.error('Upsert resource error:', response.error);
      return res.status(500).json(formatError('Failed to save resource'));
    }

    return res.json({ success: true, data: response.data });
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

    const { error } = await supabase
      .from('subcategory_resources')
      .delete()
      .eq('id', resourceId)
      .eq('subcategory_id', subcategoryId);

    if (error) {
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
