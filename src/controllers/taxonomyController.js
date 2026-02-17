const supabase = require('../config/database');
const logger = require('../config/logger');
const { slugify, ensureUniqueSlug } = require('../utils/slugify');
const { uploadCategoryLogo, uploadSubcategoryLogo, deleteFile, extractKeyFromUrl } = require('../services/uploadService');

const fetchSubcategoryRecord = async (categoryId, subcategorySlug, select = 'id, name, slug, description, category_id, logo_url, display_order, is_active, created_at, updated_at', includeActiveFilter = true) => {
  let baseQuery = supabase
    .from('exam_subcategories')
    .select(select)
    .eq('slug', subcategorySlug)
    .eq('category_id', categoryId);

  if (includeActiveFilter) {
    baseQuery = baseQuery.or('is_active.eq.true,is_active.is.null');
  }

  let { data, error } = await baseQuery.limit(1);

  // If columns are missing (e.g. logo_url not yet migrated), retry with safe columns
  if (error?.code === '42703') {
    let fallbackQuery = supabase
      .from('exam_subcategories')
      .select('id, name, slug, description, category_id, created_at, updated_at')
      .eq('slug', subcategorySlug)
      .eq('category_id', categoryId);

    if (includeActiveFilter) {
      fallbackQuery = fallbackQuery.or('is_active.eq.true,is_active.is.null');
    }

    ({ data, error } = await fallbackQuery.limit(1));
  }

  // .limit(1) returns an array; extract the first row or null
  const row = Array.isArray(data) ? data[0] || null : data;
  return { data: row, error: row ? null : error };
};

const deleteSubcategory = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: subcategory, error: fetchError } = await supabase
      .from('exam_subcategories')
      .select('logo_url')
      .eq('id', id)
      .single();

    if (fetchError || !subcategory) {
      return res.status(404).json({ success: false, message: 'Subcategory not found' });
    }

    if (subcategory.logo_url) {
      const key = extractKeyFromUrl(subcategory.logo_url);
      if (key) {
        try {
          await deleteFile(key);
        } catch (err) {
          logger.warn('Failed to delete subcategory logo:', err);
        }
      }
    }

    const { error } = await supabase
      .from('exam_subcategories')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error('Delete subcategory error:', error);
      return res.status(500).json({ success: false, message: 'Failed to delete subcategory' });
    }

    res.json({ success: true, message: 'Subcategory deleted successfully' });
  } catch (error) {
    logger.error('Delete subcategory error:', error);
    res.status(500).json({ success: false, message: 'Server error while deleting subcategory' });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: category, error: fetchError } = await supabase
      .from('exam_categories')
      .select('id, logo_url')
      .eq('id', id)
      .single();

    if (fetchError || !category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const { data: subcategories } = await supabase
      .from('exam_subcategories')
      .select('id, logo_url')
      .eq('category_id', id);

    if (Array.isArray(subcategories) && subcategories.length > 0) {
      for (const sub of subcategories) {
        if (sub.logo_url) {
          const key = extractKeyFromUrl(sub.logo_url);
          if (key) {
            try {
              await deleteFile(key);
            } catch (err) {
              logger.warn('Failed to delete subcategory logo during category deletion:', err);
            }
          }
        }
      }

      const subIds = subcategories.map((sub) => sub.id);
      const { error: subDeleteError } = await supabase
        .from('exam_subcategories')
        .delete()
        .in('id', subIds);

      if (subDeleteError) {
        logger.error('Delete subcategories error:', subDeleteError);
        return res.status(500).json({ success: false, message: 'Failed to delete linked subcategories' });
      }
    }

    if (category.logo_url) {
      const key = extractKeyFromUrl(category.logo_url);
      if (key) {
        try {
          await deleteFile(key);
        } catch (err) {
          logger.warn('Failed to delete category logo during deletion:', err);
        }
      }
    }

    const { error } = await supabase
      .from('exam_categories')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error('Delete category error:', error);
      return res.status(500).json({ success: false, message: 'Failed to delete category' });
    }

    res.json({ success: true, message: 'Category deleted successfully' });
  } catch (error) {
    logger.error('Delete category error:', error);
    res.status(500).json({ success: false, message: 'Server error while deleting category' });
  }
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

    const baseSelect = 'id, category_id, name, slug, description, logo_url, display_order, is_active, created_at, updated_at, exam_categories(name, slug)';
    let query = supabase
      .from('exam_subcategories')
      .select(baseSelect)
      .order('display_order', { ascending: true })
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
    const { category_id, name, description, slug, display_order, is_active } = req.body;
    const logoFile = req.file;

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
    const uniqueSlug = await ensureUniqueSlug(supabase, 'exam_subcategories', normalizedSlug);

    let logo_url = null;
    if (logoFile) {
      const uploadResult = await uploadSubcategoryLogo(logoFile);
      logo_url = uploadResult.url;
    }

    const insertData = {
      category_id,
      name,
      description,
      slug: uniqueSlug,
      logo_url,
      display_order: display_order ? parseInt(display_order) : 0,
      is_active: is_active !== undefined ? is_active === 'true' || is_active === true : true
    };

    const { data, error } = await supabase
      .from('exam_subcategories')
      .insert(insertData)
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
    const logoFile = req.file;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Subcategory name is required' });
    }

    const { data: existingSubcategory, error: fetchError } = await supabase
      .from('exam_subcategories')
      .select('category_id, slug, logo_url')
      .eq('id', id)
      .single();

    if (fetchError || !existingSubcategory) {
      return res.status(404).json({ success: false, message: 'Subcategory not found' });
    }

    let normalizedSlug = slug ? slugify(slug) : slugify(name);
    normalizedSlug = await ensureUniqueSlug(supabase, 'exam_subcategories', normalizedSlug, {
      excludeId: id
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

    if (logoFile) {
      if (existingSubcategory.logo_url) {
        const oldKey = extractKeyFromUrl(existingSubcategory.logo_url);
        if (oldKey) {
          try {
            await deleteFile(oldKey);
          } catch (err) {
            logger.warn('Failed to delete old subcategory logo:', err);
          }
        }
      }
      const uploadResult = await uploadSubcategoryLogo(logoFile);
      updateData.logo_url = uploadResult.url;
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

    const { data: categories, error } = await supabase
      .from('exam_categories')
      .select('id, name, slug, description, logo_url, icon')
      .eq('slug', slug)
      .or('is_active.eq.true,is_active.is.null');

    const category = categories?.[0];
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

    const detailedSelect = 'id, name, slug, description, category_id, logo_url, display_order, is_active, created_at, updated_at';
    const fallbackSelect = 'id, name, slug, description, category_id, logo_url, created_at, updated_at';

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
    let categorySlug = null;
    if (data.category_id) {
      const { data: categoryData, error: categoryError } = await supabase
        .from('exam_categories')
        .select('id, name, slug')
        .eq('id', data.category_id)
        .maybeSingle();

      if (categoryData && !categoryError) {
        category = categoryData;
        categorySlug = categoryData.slug;
      }
    }

    return res.json({ success: true, data: { ...data, category, category_slug: categorySlug } });
  } catch (error) {
    logger.error('Get subcategory by id error:', error);
    return res.status(500).json({ success: false, message: 'Server error while fetching subcategory' });
  }
};

const getExamsByCategory = async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 12, difficulty, subcategory, search } = req.query;
    const pageNumber = Number.parseInt(page, 10) || 1;
    const limitNumber = Math.min(Number.parseInt(limit, 10) || 12, 100);

    const { data: categories } = await supabase
      .from('exam_categories')
      .select('id')
      .eq('slug', slug)
      .or('is_active.eq.true,is_active.is.null');

    const category = categories?.[0];
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const offset = (pageNumber - 1) * limitNumber;

    let query = supabase
      .from('exams')
      .select(`
        id,
        title,
        duration,
        total_marks,
        total_questions,
        difficulty,
        status,
        start_date,
        end_date,
        is_free,
        logo_url,
        thumbnail_url,
        slug,
        url_path,
        subcategory,
        supports_hindi
      `, { count: 'exact' })
      .or(`category_id.eq.${category.id},category.ilike.%${slug}%`)
      .eq('is_published', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNumber - 1);

    if (difficulty) {
      query = query.eq('difficulty', difficulty);
    }

    if (subcategory) {
      query = query.eq('subcategory', subcategory);
    }

    if (search) {
      query = query.ilike('title', `%${search}%`);
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
        page: pageNumber,
        limit: limitNumber,
        total: count || exams?.length || 0,
        totalPages: count ? Math.ceil(count / limitNumber) : 1
      }
    });
  } catch (error) {
    logger.error('Get exams by category error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching exams' });
  }
};

const parseCategorySlug = (slug = '') => slug.trim();
const parseSubcategorySlug = (slug = '') => slug.trim();

const getSubcategoryBySlug = async (req, res) => {
  try {
    const { categorySlug, subcategorySlug } = req.params;
    const resolvedCategorySlug = parseCategorySlug(categorySlug);
    const resolvedSubcategorySlug = parseSubcategorySlug(subcategorySlug);

    const { data: categories } = await supabase
      .from('exam_categories')
      .select('id, name, slug')
      .eq('slug', resolvedCategorySlug)
      .or('is_active.eq.true,is_active.is.null');

    const category = categories?.[0];
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const { data: subcategory, error } = await fetchSubcategoryRecord(category.id, resolvedSubcategorySlug, undefined, false);

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
    const resolvedCategorySlug = parseCategorySlug(categorySlug);
    const resolvedSubcategorySlug = parseSubcategorySlug(subcategorySlug);
    const { page = 1, limit = 12, difficulty, search, exam_type } = req.query;
    const pageNumber = Number.parseInt(page, 10) || 1;
    const limitNumber = Math.min(Number.parseInt(limit, 10) || 12, 100);

    const { data: categories } = await supabase
      .from('exam_categories')
      .select('id')
      .eq('slug', resolvedCategorySlug)
      .or('is_active.eq.true,is_active.is.null');

    const category = categories?.[0];
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const { data: subcategory } = await fetchSubcategoryRecord(category.id, resolvedSubcategorySlug, 'id', false);

    if (!subcategory) {
      return res.json({ success: true, data: [], pagination: { page: pageNumber, limit: limitNumber, total: 0, totalPages: 0 } });
    }

    const offset = (pageNumber - 1) * limitNumber;

    let query = supabase
      .from('exams')
      .select(`
        id,
        title,
        duration,
        total_marks,
        total_questions,
        difficulty,
        status,
        start_date,
        end_date,
        is_free,
        logo_url,
        thumbnail_url,
        slug,
        url_path,
        exam_type,
        subcategory,
        supports_hindi,
        show_in_mock_tests
      `, { count: 'exact' })
      .eq('subcategory_id', subcategory.id)
      .eq('is_published', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNumber - 1);

    if (difficulty) {
      query = query.eq('difficulty', difficulty);
    }

    if (exam_type) {
      query = query.eq('exam_type', exam_type);
    }

    if (search) {
      query = query.ilike('title', `%${search}%`);
    }

    const { data: exams, error, count } = await query;

    if (error) {
      logger.error('Get exams by subcategory error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch exams' });
    }

    res.json({
      success: true,
      data: exams || [],
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total: count || exams?.length || 0,
        totalPages: count ? Math.ceil(count / limitNumber) : 1
      }
    });
  } catch (error) {
    logger.error('Get exams by subcategory error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching exams' });
  }
};

const reorderSubcategories = async (req, res) => {
  try {
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ success: false, message: 'orderedIds array is required' });
    }

    const updates = orderedIds.map((id, index) =>
      supabase
        .from('exam_subcategories')
        .update({ display_order: index })
        .eq('id', id)
    );

    const results = await Promise.all(updates);
    const failed = results.find((r) => r.error);
    if (failed) {
      logger.error('Reorder subcategories error:', failed.error);
      return res.status(500).json({ success: false, message: 'Failed to reorder subcategories' });
    }

    res.json({ success: true, message: 'Subcategories reordered successfully' });
  } catch (error) {
    logger.error('Reorder subcategories error:', error);
    res.status(500).json({ success: false, message: 'Server error while reordering subcategories' });
  }
};

const getSubcategoryByOwnSlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const { data: subcategories, error } = await supabase
      .from('exam_subcategories')
      .select('id, name, slug, description, category_id, logo_url, display_order, is_active, created_at, updated_at')
      .eq('slug', slug)
      .or('is_active.eq.true,is_active.is.null');

    const subcategory = subcategories?.[0];
    if (error || !subcategory) {
      return res.status(404).json({ success: false, message: 'Subcategory not found' });
    }

    let category = null;
    if (subcategory.category_id) {
      const { data: categoryData } = await supabase
        .from('exam_categories')
        .select('id, name, slug')
        .eq('id', subcategory.category_id)
        .single();
      if (categoryData) {
        category = categoryData;
      }
    }

    res.json({ success: true, data: { ...subcategory, category } });
  } catch (error) {
    logger.error('Get subcategory by own slug error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching subcategory' });
  }
};

const getExamsBySubcategorySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 12, difficulty, search, exam_type } = req.query;
    const pageNumber = Number.parseInt(page, 10) || 1;
    const limitNumber = Math.min(Number.parseInt(limit, 10) || 12, 100);

    const { data: subcategories } = await supabase
      .from('exam_subcategories')
      .select('id')
      .eq('slug', slug)
      .or('is_active.eq.true,is_active.is.null');

    const subcategory = subcategories?.[0];
    if (!subcategory) {
      return res.json({ success: true, data: [], pagination: { page: pageNumber, limit: limitNumber, total: 0, totalPages: 0 } });
    }

    const offset = (pageNumber - 1) * limitNumber;

    let query = supabase
      .from('exams')
      .select(`
        id,
        title,
        duration,
        total_marks,
        total_questions,
        difficulty,
        status,
        start_date,
        end_date,
        is_free,
        logo_url,
        thumbnail_url,
        slug,
        url_path,
        exam_type,
        subcategory,
        supports_hindi,
        show_in_mock_tests
      `, { count: 'exact' })
      .eq('subcategory_id', subcategory.id)
      .eq('is_published', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNumber - 1);

    if (difficulty) {
      query = query.eq('difficulty', difficulty);
    }

    if (exam_type) {
      query = query.eq('exam_type', exam_type);
    }

    if (search) {
      query = query.ilike('title', `%${search}%`);
    }

    const { data: exams, error, count } = await query;

    if (error) {
      logger.error('Get exams by subcategory slug error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch exams' });
    }

    res.json({
      success: true,
      data: exams || [],
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total: count || exams?.length || 0,
        totalPages: count ? Math.ceil(count / limitNumber) : 1
      }
    });
  } catch (error) {
    logger.error('Get exams by subcategory slug error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching exams' });
  }
};

const resolveCombinedSlug = async (req, res) => {
  try {
    const { combinedSlug } = req.params;
    if (!combinedSlug || !combinedSlug.includes('-')) {
      return res.status(404).json({ success: false, message: 'Invalid combined slug' });
    }

    const parts = combinedSlug.split('-');

    // Try every possible split point: category = parts[0..i], subcategory = parts[i+1..end]
    for (let i = 0; i < parts.length - 1; i++) {
      const candidateCatSlug = parts.slice(0, i + 1).join('-');
      const candidateSubSlug = parts.slice(i + 1).join('-');

      const { data: categories } = await supabase
        .from('exam_categories')
        .select('id, name, slug')
        .eq('slug', candidateCatSlug)
        .or('is_active.eq.true,is_active.is.null');

      const category = categories?.[0];
      if (!category) continue;

      const { data: subcategory } = await fetchSubcategoryRecord(category.id, candidateSubSlug, undefined, false);
      if (!subcategory) continue;

      // Found a valid match
      return res.json({
        success: true,
        data: {
          ...subcategory,
          category
        }
      });
    }

    return res.status(404).json({ success: false, message: 'No matching category/subcategory found' });
  } catch (error) {
    logger.error('Resolve combined slug error:', error);
    res.status(500).json({ success: false, message: 'Server error while resolving slug' });
  }
};

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getSubcategories,
  createSubcategory,
  updateSubcategory,
  deleteSubcategory,
  reorderSubcategories,
  getDifficulties,
  createDifficulty,
  getCategoryById,
  getCategoryBySlug,
  getSubcategoryById,
  getSubcategoryByOwnSlug,
  getExamsByCategory,
  getSubcategoryBySlug,
  getExamsBySubcategory,
  getExamsBySubcategorySlug,
  resolveCombinedSlug
};
