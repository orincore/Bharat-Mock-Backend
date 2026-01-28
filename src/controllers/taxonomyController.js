const supabase = require('../config/database');
const logger = require('../config/logger');
const { slugify, ensureUniqueSlug } = require('../utils/slugify');
const { uploadCategoryLogo, deleteFile, extractKeyFromUrl } = require('../services/uploadService');

const fetchSubcategoryRecord = async (categoryId, subcategorySlug, select = 'id, name, slug, description, category_id, display_order, is_active, created_at, updated_at', includeActiveFilter = true) => {
  const baseQuery = supabase
    .from('exam_subcategories')
    .select(select)
    .eq('slug', subcategorySlug)
    .eq('category_id', categoryId)
    .single();

  const query = includeActiveFilter
    ? baseQuery.or('is_active.eq.true,is_active.is.null')
    : baseQuery;
  let { data, error } = await query;

  if (error?.code === '42703') {
    ({ data, error } = await supabase
      .from('exam_subcategories')
      .select('id, name, slug, description, category_id, created_at, updated_at')
      .eq('slug', subcategorySlug)
      .eq('category_id', categoryId)
      .single());
  }

  return { data, error };
};

const getCategories = async (req, res) => {
  try {
    const { search } = req.query;
    let query = supabase
      .from('exam_categories')
      .select('id, name, slug, description, logo_url, icon, display_order, is_active, created_at, updated_at')
      .order('display_order', { ascending: true })
      .order('name', { ascending: true });

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Get categories error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch categories' });
    }

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Get categories error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching categories' });
  }
};

const createCategory = async (req, res) => {
  try {
    const { name, description, slug, icon, display_order, is_active } = req.body;
    const logoFile = req.file;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    const normalizedSlug = slugify(slug || name);
    const uniqueSlug = await ensureUniqueSlug(supabase, 'exam_categories', normalizedSlug);

    let logo_url = null;
    if (logoFile) {
      const uploadResult = await uploadCategoryLogo(logoFile);
      logo_url = uploadResult.url;
    }

    const insertData = {
      name,
      description,
      slug: uniqueSlug,
      logo_url,
      icon,
      display_order: display_order ? parseInt(display_order) : 0,
      is_active: is_active !== undefined ? is_active === 'true' || is_active === true : true
    };

    const { data, error } = await supabase
      .from('exam_categories')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      logger.error('Create category error:', error);
      return res.status(500).json({ success: false, message: 'Failed to create category' });
    }

    res.status(201).json({ success: true, data });
  } catch (error) {
    logger.error('Create category error:', error);
    res.status(500).json({ success: false, message: 'Server error while creating category' });
  }
};

const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, slug, icon, display_order, is_active } = req.body;
    const logoFile = req.file;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    const { data: existingCategory } = await supabase
      .from('exam_categories')
      .select('logo_url')
      .eq('id', id)
      .single();

    if (!existingCategory) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    let updatedSlug = slug ? slugify(slug) : slugify(name);
    updatedSlug = await ensureUniqueSlug(supabase, 'exam_categories', updatedSlug, {
      excludeId: id
    });

    const updateData = {
      name,
      description,
      slug: updatedSlug,
      icon,
      display_order: display_order ? parseInt(display_order) : 0,
      is_active: is_active !== undefined ? is_active === 'true' || is_active === true : true
    };

    if (logoFile) {
      if (existingCategory.logo_url) {
        const oldKey = extractKeyFromUrl(existingCategory.logo_url);
        if (oldKey) {
          try {
            await deleteFile(oldKey);
          } catch (err) {
            logger.warn('Failed to delete old category logo:', err);
          }
        }
      }
      const uploadResult = await uploadCategoryLogo(logoFile);
      updateData.logo_url = uploadResult.url;
    }

    const { data, error } = await supabase
      .from('exam_categories')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Update category error:', error);
      return res.status(500).json({ success: false, message: 'Failed to update category' });
    }

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Update category error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating category' });
  }
};

const getSubcategories = async (req, res) => {
  try {
    const { category_id, search } = req.query;

    const baseSelect = 'id, category_id, name, slug, description, display_order, is_active, created_at, updated_at, exam_categories(name, slug)';
    let query = supabase
      .from('exam_subcategories')
      .select(baseSelect)
      .order('name', { ascending: true });

    if (category_id) {
      query = query.eq('category_id', category_id);
    }

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    let { data, error } = await query;

    if (error?.code === '42703') {
      logger.warn('exam_subcategories missing new columns, retrying without display_order/is_active. Run migrations.');
      query = supabase
        .from('exam_subcategories')
        .select('id, category_id, name, slug, description, created_at, updated_at, exam_categories(name, slug)')
        .order('name', { ascending: true });
      if (category_id) {
        query = query.eq('category_id', category_id);
      }
      if (search) {
        query = query.ilike('name', `%${search}%`);
      }
      ({ data, error } = await query);
    }

    if (error) {
      logger.error('Get subcategories error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch subcategories' });
    }

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Get subcategories error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching subcategories' });
  }
};

const createSubcategory = async (req, res) => {
  try {
    const { category_id, name, description, slug } = req.body;

    if (!category_id || !name) {
      return res.status(400).json({ success: false, message: 'Category ID and name are required' });
    }

    const { data: category } = await supabase
      .from('exam_categories')
      .select('id')
      .eq('id', category_id)
      .single();

    if (!category) {
      return res.status(404).json({ success: false, message: 'Parent category not found' });
    }

    const normalizedSlug = slugify(slug || name);
    const uniqueSlug = await ensureUniqueSlug(supabase, 'exam_subcategories', normalizedSlug, {
      filters: { category_id }
    });

    const { data, error } = await supabase
      .from('exam_subcategories')
      .insert({ category_id, name, description, slug: uniqueSlug })
      .select()
      .single();

    if (error) {
      logger.error('Create subcategory error:', error);
      return res.status(500).json({ success: false, message: 'Failed to create subcategory' });
    }

    res.status(201).json({ success: true, data });
  } catch (error) {
    logger.error('Create subcategory error:', error);
    res.status(500).json({ success: false, message: 'Server error while creating subcategory' });
  }
};

const updateSubcategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, slug, display_order, is_active } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Subcategory name is required' });
    }

    const { data: existingSubcategory, error: fetchError } = await supabase
      .from('exam_subcategories')
      .select('category_id, slug')
      .eq('id', id)
      .single();

    if (fetchError || !existingSubcategory) {
      return res.status(404).json({ success: false, message: 'Subcategory not found' });
    }

    let normalizedSlug = slug ? slugify(slug) : slugify(name);
    normalizedSlug = await ensureUniqueSlug(supabase, 'exam_subcategories', normalizedSlug, {
      excludeId: id,
      filters: { category_id: existingSubcategory.category_id }
    });

    const updateData = {
      name,
      description,
      slug: normalizedSlug
    };

    if (display_order !== undefined && display_order !== null && display_order !== '') {
      updateData.display_order = parseInt(display_order, 10);
    }

    if (is_active !== undefined) {
      updateData.is_active = is_active === 'true' || is_active === true;
    }

    let { data, error } = await supabase
      .from('exam_subcategories')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error?.code === 'PGRST204') {
      const fallbackData = { name: updateData.name, description: updateData.description, slug: updateData.slug };
      logger.warn('Column missing on exam_subcategories, retrying update without optional fields. Run latest migrations to add display_order/is_active.');
      ({ data, error } = await supabase
        .from('exam_subcategories')
        .update(fallbackData)
        .eq('id', id)
        .select()
        .single());
    }

    if (error) {
      logger.error('Update subcategory error:', error);
      return res.status(500).json({ success: false, message: 'Failed to update subcategory' });
    }

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Update subcategory error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating subcategory' });
  }
};

const getDifficulties = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('exam_difficulties')
      .select('id, name, slug, description, level_order')
      .order('level_order', { ascending: true });

    if (error) {
      logger.error('Get difficulties error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch difficulty levels' });
    }

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Get difficulties error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching difficulty levels' });
  }
};

const createDifficulty = async (req, res) => {
  try {
    const { name, description, slug, level_order } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Difficulty name is required' });
    }

    const normalizedSlug = slugify(slug || name);
    const uniqueSlug = await ensureUniqueSlug(supabase, 'exam_difficulties', normalizedSlug);

    const { data, error } = await supabase
      .from('exam_difficulties')
      .insert({ name, description, slug: uniqueSlug, level_order: level_order ? parseInt(level_order) : 0 })
      .select()
      .single();

    if (error) {
      logger.error('Create difficulty error:', error);
      return res.status(500).json({ success: false, message: 'Failed to create difficulty level' });
    }

    res.status(201).json({ success: true, data });
  } catch (error) {
    logger.error('Create difficulty error:', error);
    res.status(500).json({ success: false, message: 'Server error while creating difficulty level' });
  }
};

const getCategoryById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: category, error } = await supabase
      .from('exam_categories')
      .select('id, name, slug, description, logo_url, icon, display_order, is_active, created_at, updated_at')
      .eq('id', id)
      .single();

    if (error || !category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    res.json({ success: true, data: category });
  } catch (error) {
    logger.error('Get category by id error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching category' });
  }
};

const getCategoryBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const { data: category, error } = await supabase
      .from('exam_categories')
      .select('id, name, slug, description, logo_url, icon')
      .eq('slug', slug)
      .eq('is_active', true)
      .single();

    if (error || !category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    res.json({ success: true, data: category });
  } catch (error) {
    logger.error('Get category by slug error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching category' });
  }
};

const getSubcategoryById = async (req, res) => {
  try {
    const identifier = (req.params.id || '').trim();

    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Subcategory identifier is required' });
    }

    const detailedSelect = 'id, name, slug, description, category_id, display_order, is_active, created_at, updated_at';
    const fallbackSelect = 'id, name, slug, description, category_id, created_at, updated_at';

    let { data, error } = await supabase
      .from('exam_subcategories')
      .select(detailedSelect)
      .eq('id', identifier)
      .maybeSingle();

    if (error?.code === '42703') {
      ({ data, error } = await supabase
        .from('exam_subcategories')
        .select(fallbackSelect)
        .eq('id', identifier)
        .maybeSingle());
    }

    if (!data) {
      let fallback = await supabase
        .from('exam_subcategories')
        .select(detailedSelect)
        .eq('slug', identifier)
        .maybeSingle();
      data = fallback.data;
      error = fallback.error;

      if (error?.code === '42703') {
        fallback = await supabase
          .from('exam_subcategories')
          .select(fallbackSelect)
          .eq('slug', identifier)
          .maybeSingle();
        data = fallback.data;
        error = fallback.error;
      }
    }

    if (!data) {
      return res.status(404).json({ success: false, message: 'Subcategory not found' });
    }

    let category = null;
    if (data.category_id) {
      const { data: categoryData, error: categoryError } = await supabase
        .from('exam_categories')
        .select('id, name, slug')
        .eq('id', data.category_id)
        .maybeSingle();

      if (categoryData && !categoryError) {
        category = categoryData;
      }
    }

    return res.json({ success: true, data: { ...data, category } });
  } catch (error) {
    logger.error('Get subcategory by id error:', error);
    return res.status(500).json({ success: false, message: 'Server error while fetching subcategory' });
  }
};

const getExamsByCategory = async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 12, difficulty, subcategory, search } = req.query;

    const { data: category } = await supabase
      .from('exam_categories')
      .select('id')
      .eq('slug', slug)
      .eq('is_active', true)
      .single();

    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const offset = (page - 1) * limit;

    let query = supabase
      .from('exams')
      .select(`
        id,
        title,
        description,
        duration,
        total_marks,
        total_questions,
        difficulty,
        status,
        start_date,
        end_date,
        is_free,
        price,
        logo_url,
        thumbnail_url,
        slug,
        url_path,
        subcategory
      `, { count: 'exact' })
      .or(`category_id.eq.${category.id},category.ilike.%${slug}%`)
      .eq('is_published', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (difficulty) {
      query = query.eq('difficulty', difficulty);
    }

    if (subcategory) {
      query = query.eq('subcategory', subcategory);
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data: exams, error, count } = await query;

    if (error) {
      logger.error('Get exams by category error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch exams' });
    }

    res.json({
      success: true,
      data: exams,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    logger.error('Get exams by category error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching exams' });
  }
};

const getSubcategoryBySlug = async (req, res) => {
  try {
    const { categorySlug, subcategorySlug } = req.params;

    const { data: category } = await supabase
      .from('exam_categories')
      .select('id, name, slug')
      .eq('slug', categorySlug)
      .eq('is_active', true)
      .single();

    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const { data: subcategory, error } = await fetchSubcategoryRecord(category.id, subcategorySlug);

    if (error || !subcategory) {
      logger.error('Get subcategory by slug error:', error);
      return res.status(404).json({ success: false, message: 'Subcategory not found' });
    }

    res.json({ 
      success: true, 
      data: {
        ...subcategory,
        category
      }
    });
  } catch (error) {
    logger.error('Get subcategory by slug error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching subcategory' });
  }
};

const getExamsBySubcategory = async (req, res) => {
  try {
    const { categorySlug, subcategorySlug } = req.params;
    const { page = 1, limit = 12, difficulty, search } = req.query;

    const { data: category } = await supabase
      .from('exam_categories')
      .select('id')
      .eq('slug', categorySlug)
      .eq('is_active', true)
      .single();

    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const { data: subcategory } = await fetchSubcategoryRecord(category.id, subcategorySlug, 'id');

    if (!subcategory) {
      return res.status(404).json({ success: false, message: 'Subcategory not found' });
    }

    const offset = (page - 1) * limit;

    let query = supabase
      .from('exams')
      .select(`
        id,
        title,
        description,
        duration,
        total_marks,
        total_questions,
        difficulty,
        status,
        start_date,
        end_date,
        is_free,
        price,
        logo_url,
        thumbnail_url,
        slug,
        url_path,
        subcategory
      `, { count: 'exact' })
      .eq('subcategory_id', subcategory.id)
      .eq('is_published', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (difficulty) {
      query = query.eq('difficulty', difficulty);
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data: exams, error, count } = await query;

    if (error) {
      logger.error('Get exams by subcategory error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch exams' });
    }

    res.json({
      success: true,
      data: exams,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    logger.error('Get exams by subcategory error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching exams' });
  }
};

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  getSubcategories,
  createSubcategory,
  updateSubcategory,
  getDifficulties,
  createDifficulty,
  getCategoryById,
  getCategoryBySlug,
  getSubcategoryById,
  getExamsByCategory,
  getSubcategoryBySlug,
  getExamsBySubcategory
};
