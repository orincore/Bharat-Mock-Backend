const supabase = require('../config/database');
const logger = require('../config/logger');
const { slugify, ensureUniqueSlug } = require('../utils/slugify');

const getCategories = async (req, res) => {
  try {
    const { search } = req.query;
    let query = supabase
      .from('exam_categories')
      .select('id, name, slug, description, created_at, updated_at')
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
    const { name, description, slug } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    const normalizedSlug = slugify(slug || name);
    const uniqueSlug = await ensureUniqueSlug(supabase, 'exam_categories', normalizedSlug);

    const { data, error } = await supabase
      .from('exam_categories')
      .insert({ name, description, slug: uniqueSlug })
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
    const { name, description, slug } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    let updatedSlug = slug ? slugify(slug) : slugify(name);
    updatedSlug = await ensureUniqueSlug(supabase, 'exam_categories', updatedSlug, {
      excludeId: id
    });

    const { data, error } = await supabase
      .from('exam_categories')
      .update({ name, description, slug: updatedSlug })
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

    let query = supabase
      .from('exam_subcategories')
      .select('id, category_id, name, slug, description, created_at, updated_at, exam_categories(name, slug)')
      .order('name', { ascending: true });

    if (category_id) {
      query = query.eq('category_id', category_id);
    }

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    const { data, error } = await query;

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

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  getSubcategories,
  createSubcategory,
  getDifficulties,
  createDifficulty
};
