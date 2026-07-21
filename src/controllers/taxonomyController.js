const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { slugify, ensureUniqueSlug } = require('../utils/slugify');
const { uploadCategoryLogo, uploadSubcategoryLogo, deleteFile, extractKeyFromUrl } = require('../services/uploadService');
const { redisCache, buildCacheKey } = require('../utils/redisCache');

const TAXONOMY_TTL = 86400; // 24 hours — invalidated on every write
const CATEGORIES_CACHE_KEY = buildCacheKey('taxonomy', 'categories');
const categorySlugKey = (slug) => buildCacheKey('taxonomy', 'category', slug);
const subcategoriesKey = (categoryId) => buildCacheKey('taxonomy', 'subcategories', categoryId);
const INIT_PUBLIC_KEY = buildCacheKey('init', 'public');
// Per-user init caches (init:user:<id>, 60s TTL) also embed the navbar category list,
// so a logged-in admin/user would keep seeing a deleted category until their key expires.
// Bust them all by pattern on every taxonomy write.
const INIT_USER_PATTERN = buildCacheKey('init', 'user', '*');
// The homepage aggregate (homepage:data) embeds the categories + subcategories shown
// in the "Choose your exam" section, so it must be busted on any taxonomy write too.
const HOMEPAGE_CACHE_KEY = buildCacheKey('homepage', 'data');

// Invalidates the categories list + a specific slug key + init (public & all per-user) + homepage:data
// (both init and homepage embed categories)
const invalidateCategoryCache = async (slug) => {
  const ops = [
    redisCache.del(CATEGORIES_CACHE_KEY),
    redisCache.del(INIT_PUBLIC_KEY),
    redisCache.deleteByPattern(INIT_USER_PATTERN),
    redisCache.del(HOMEPAGE_CACHE_KEY),
  ];
  if (slug) ops.push(redisCache.del(categorySlugKey(slug)));
  await Promise.all(ops);
  console.log(`[Cache] Invalidated taxonomy:categories + init:public + init:user:* + homepage:data${slug ? ` + taxonomy:category:${slug}` : ''}`);
};

// Subcategory changes invalidate categories list, init (public & per-user), homepage:data,
// the per-category subcategories cache, the exam metadata cache (carries subcategory
// names/flags into exam & quiz listings) and — when a subcategory id is given — the public
// page-content cache so settings changes (name, logo, tab visibility) show up instantly.
const invalidateSubcategoryCache = async (categoryId, subcategoryId) => {
  const ops = [
    redisCache.del(CATEGORIES_CACHE_KEY),
    redisCache.del(INIT_PUBLIC_KEY),
    redisCache.deleteByPattern(INIT_USER_PATTERN),
    redisCache.del(HOMEPAGE_CACHE_KEY),
    redisCache.del(buildCacheKey('metadata', 'categories_subcategories_difficulties')),
  ];
  if (categoryId) ops.push(redisCache.del(subcategoriesKey(categoryId)));
  if (subcategoryId) ops.push(redisCache.del(buildCacheKey('page_content', subcategoryId)));
  await Promise.all(ops);
  console.log(`[Cache] Invalidated taxonomy:categories + init:public + init:user:* + homepage:data + metadata${categoryId ? ` + taxonomy:subcategories:${categoryId}` : ''}${subcategoryId ? ` + page_content:${subcategoryId}` : ''} (subcategory change)`);
};

const SUBCATEGORY_DETAIL_SELECT = {
  id: true, name: true, slug: true, description: true, category_id: true, logo_url: true,
  display_order: true, is_active: true, show_mock_tests_tab: true, show_previous_papers_tab: true,
  created_at: true, updated_at: true
};

// The original had a fallback retry for `error.code === '42703'` (undefined column) —
// defensive code for when display_order/is_active/tab-visibility columns hadn't been
// migrated onto exam_subcategories yet. Confirmed via introspection all of these columns
// exist in the live schema, so — same reasoning as the exam_sections.language dead
// fallback documented in MIGRATION_TRACKER.md §4.5b — that retry path is unreachable
// dead code now and has been dropped; this always uses the full column set.
const fetchSubcategoryRecord = async (categoryId, subcategorySlug, select = SUBCATEGORY_DETAIL_SELECT, includeActiveFilter = true) => {
  const where = { slug: subcategorySlug, category_id: categoryId };
  if (includeActiveFilter) {
    where.OR = [{ is_active: true }, { is_active: null }];
  }

  const data = await prisma.exam_subcategories.findFirst({ where, select });
  return { data: data || null, error: null };
};

const deleteSubcategory = async (req, res) => {
  try {
    const { id } = req.params;

    const subcategory = await prisma.exam_subcategories.findUnique({
      where: { id },
      select: { logo_url: true, category_id: true }
    });

    if (!subcategory) {
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

    // Null out subcategory_id on exams referencing this subcategory
    await prisma.exams.updateMany({ where: { subcategory_id: id }, data: { subcategory_id: null } });

    // Test series also reference this subcategory via a nullable FK
    // (test_series_subcategory_id_fkey) with no ON DELETE action, so the delete is
    // blocked until those references are cleared. Detach them like we do for exams.
    await prisma.test_series.updateMany({ where: { subcategory_id: id }, data: { subcategory_id: null } });

    try {
      await prisma.exam_subcategories.delete({ where: { id } });
    } catch (error) {
      logger.error('Delete subcategory error:', error);
      return res.status(500).json({ success: false, message: 'Failed to delete subcategory' });
    }

    await invalidateSubcategoryCache(subcategory.category_id, id);
    res.json({ success: true, message: 'Subcategory deleted successfully' });
  } catch (error) {
    logger.error('Delete subcategory error:', error);
    res.status(500).json({ success: false, message: 'Server error while deleting subcategory' });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await prisma.exam_categories.findUnique({
      where: { id },
      select: { id: true, logo_url: true }
    });

    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    // Fetch all subcategories under this category
    const subcategories = await prisma.exam_subcategories.findMany({
      where: { category_id: id },
      select: { id: true, logo_url: true }
    });

    const subIds = subcategories.map((s) => s.id);

    // Fetch all exams belonging to this category (directly or via subcategory)
    const directExams = await prisma.exams.findMany({
      where: { category_id: id },
      select: { id: true, logo_url: true, thumbnail_url: true }
    });

    let subExams = [];
    if (subIds.length > 0) {
      subExams = await prisma.exams.findMany({
        where: { subcategory_id: { in: subIds } },
        select: { id: true, logo_url: true, thumbnail_url: true }
      });
    }

    const allExams = [...directExams, ...subExams];
    const examIds = allExams.map((e) => e.id);

    // --- Delete all exam data in correct FK order ---
    if (examIds.length > 0) {
      // Get all question IDs for these exams
      const questions = await prisma.questions.findMany({
        where: { exam_id: { in: examIds } },
        select: { id: true, image_url: true }
      });

      const questionIds = questions.map((q) => q.id);

      // Delete question option images + records
      if (questionIds.length > 0) {
        const options = await prisma.question_options.findMany({
          where: { question_id: { in: questionIds } },
          select: { id: true, image_url: true }
        });

        for (const opt of options) {
          if (opt.image_url) {
            try { await deleteFile(extractKeyFromUrl(opt.image_url)); } catch (e) { logger.warn('Failed to delete option image:', e); }
          }
        }

        await prisma.question_options.deleteMany({ where: { question_id: { in: questionIds } } });
      }

      // Delete question images + records
      for (const q of questions) {
        if (q.image_url) {
          try { await deleteFile(extractKeyFromUrl(q.image_url)); } catch (e) { logger.warn('Failed to delete question image:', e); }
        }
      }
      await prisma.questions.deleteMany({ where: { exam_id: { in: examIds } } });

      // Delete exam sections and syllabus
      await prisma.exam_sections.deleteMany({ where: { exam_id: { in: examIds } } });
      await prisma.exam_syllabus.deleteMany({ where: { exam_id: { in: examIds } } });

      // Delete attempt-related data (results → user_answers → exam_attempts)
      const attempts = await prisma.exam_attempts.findMany({
        where: { exam_id: { in: examIds } },
        select: { id: true }
      });

      const attemptIds = attempts.map((a) => a.id);

      if (attemptIds.length > 0) {
        // NOTE: the original also attempted `section_analysis.delete().in('attempt_id',
        // attemptIds)` here, but section_analysis has no attempt_id column at all (only
        // result_id) — confirmed via introspection. That call always failed silently
        // in the original (its error was never checked). Omitted here rather than
        // reproduced literally, because Prisma would throw a hard client-side
        // validation error for a nonexistent field and abort this whole cascading
        // delete partway through — a real regression the original's silently-ignored
        // failure never caused. No functional loss: section_analysis rows are cleaned
        // up automatically anyway via its `results` relation's ON DELETE CASCADE, which
        // fires when `results` (deleted next) and ultimately `exam_attempts` (deleted
        // below) are removed.
        await prisma.results.deleteMany({ where: { attempt_id: { in: attemptIds } } });
        await prisma.user_answers.deleteMany({ where: { attempt_id: { in: attemptIds } } });
        await prisma.exam_attempts.deleteMany({ where: { id: { in: attemptIds } } });
      }

      // Delete exam media files
      for (const exam of allExams) {
        if (exam.logo_url) {
          try { await deleteFile(extractKeyFromUrl(exam.logo_url)); } catch (e) { logger.warn('Failed to delete exam logo:', e); }
        }
        if (exam.thumbnail_url) {
          try { await deleteFile(extractKeyFromUrl(exam.thumbnail_url)); } catch (e) { logger.warn('Failed to delete exam thumbnail:', e); }
        }
      }

      // Delete the exams themselves
      try {
        await prisma.exams.deleteMany({ where: { id: { in: examIds } } });
      } catch (examsDeleteError) {
        logger.error('Delete exams error:', examsDeleteError);
        return res.status(500).json({ success: false, message: 'Failed to delete linked exams' });
      }
    }

    // Detach test series that reference this category or its subcategories via nullable
    // FKs (no ON DELETE action), otherwise the subcategory/category deletes below are
    // blocked by test_series_subcategory_id_fkey / test_series_category_id_fkey.
    if (subIds.length > 0) {
      await prisma.test_series.updateMany({ where: { subcategory_id: { in: subIds } }, data: { subcategory_id: null } });
    }
    await prisma.test_series.updateMany({ where: { category_id: id }, data: { category_id: null } });

    // Delete subcategory logos + records
    for (const sub of subcategories) {
      if (sub.logo_url) {
        try { await deleteFile(extractKeyFromUrl(sub.logo_url)); } catch (e) { logger.warn('Failed to delete subcategory logo:', e); }
      }
    }
    if (subIds.length > 0) {
      try {
        await prisma.exam_subcategories.deleteMany({ where: { id: { in: subIds } } });
      } catch (subDeleteError) {
        logger.error('Delete subcategories error:', subDeleteError);
        return res.status(500).json({ success: false, message: 'Failed to delete linked subcategories' });
      }
    }

    // Delete category logo
    if (category.logo_url) {
      try { await deleteFile(extractKeyFromUrl(category.logo_url)); } catch (e) { logger.warn('Failed to delete category logo:', e); }
    }

    // Finally delete the category
    try {
      await prisma.exam_categories.delete({ where: { id } });
    } catch (error) {
      logger.error('Delete category error:', error);
      return res.status(500).json({ success: false, message: 'Failed to delete category' });
    }

    // NOTE (preserved from original): `category` was only fetched with `{id, logo_url}`
    // above, so `category?.slug` is always undefined here — the per-slug cache key is
    // never actually busted by this call. Not fixed here; same as the original, and the
    // main categories list + init + homepage caches are still busted regardless.
    await invalidateCategoryCache(category?.slug);
    res.json({
      success: true,
      message: `Category deleted along with ${allExams.length} exam(s) and ${subIds.length} subcategory(ies)`
    });
  } catch (error) {
    logger.error('Delete category error:', error);
    res.status(500).json({ success: false, message: 'Server error while deleting category' });
  }
};

const getCategories = async (req, res) => {
  try {
    const { search } = req.query;

    // Only cache unfiltered requests (no search param)
    if (!search) {
      const cached = await redisCache.get(CATEGORIES_CACHE_KEY);
      if (cached) {
        console.log('[Cache] HIT  taxonomy:categories');
        return res.json(cached);
      }
      console.log('[Cache] MISS taxonomy:categories — fetching from DB');
    }

    let data;
    try {
      data = await prisma.exam_categories.findMany({
        where: search ? { name: { contains: search, mode: 'insensitive' } } : undefined,
        select: { id: true, name: true, slug: true, description: true, logo_url: true, icon: true, display_order: true, is_active: true, created_at: true, updated_at: true },
        orderBy: [{ display_order: 'asc' }, { name: 'asc' }]
      });
    } catch (error) {
      logger.error('Get categories error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch categories' });
    }

    const responsePayload = { success: true, data };

    if (!search) {
      await redisCache.set(CATEGORIES_CACHE_KEY, responsePayload, TAXONOMY_TTL);
      console.log(`[Cache] SET  taxonomy:categories (TTL ${TAXONOMY_TTL}s)`);
    }

    res.json(responsePayload);
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
    const uniqueSlug = await ensureUniqueSlug(prisma.exam_categories, normalizedSlug);

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

    let data;
    try {
      data = await prisma.exam_categories.create({ data: insertData });
    } catch (error) {
      logger.error('Create category error:', error);
      return res.status(500).json({ success: false, message: 'Failed to create category' });
    }

    await invalidateCategoryCache(null);
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

    const existingCategory = await prisma.exam_categories.findUnique({
      where: { id },
      select: { logo_url: true }
    });

    if (!existingCategory) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    let updatedSlug = slug ? slugify(slug) : slugify(name);
    updatedSlug = await ensureUniqueSlug(prisma.exam_categories, updatedSlug, {
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

    let data;
    try {
      data = await prisma.exam_categories.update({ where: { id }, data: updateData });
    } catch (error) {
      logger.error('Update category error:', error);
      return res.status(500).json({ success: false, message: 'Failed to update category' });
    }

    // Invalidate both the list and the old + new slug keys
    await invalidateCategoryCache(data?.slug);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('Update category error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating category' });
  }
};

const getSubcategories = async (req, res) => {
  try {
    const { category_id, search } = req.query;

    // Cache per-category filtered requests (skip cache for search or unfiltered)
    const canCache = category_id && !search;
    if (canCache) {
      const cacheKey = subcategoriesKey(category_id);
      const cached = await redisCache.get(cacheKey);
      if (cached) {
        console.log(`[Cache] HIT  taxonomy:subcategories:${category_id}`);
        return res.json(cached);
      }
      console.log(`[Cache] MISS taxonomy:subcategories:${category_id} — fetching from DB`);
    }

    const where = {};
    if (category_id) where.category_id = category_id;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    let data;
    try {
      data = await prisma.exam_subcategories.findMany({
        where,
        select: {
          id: true, category_id: true, name: true, slug: true, description: true, logo_url: true,
          display_order: true, is_active: true, show_mock_tests_tab: true, show_previous_papers_tab: true,
          created_at: true, updated_at: true,
          exam_categories: { select: { name: true, slug: true } }
        },
        orderBy: [{ display_order: 'asc' }, { name: 'asc' }]
      });
    } catch (error) {
      logger.error('Get subcategories error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch subcategories' });
    }

    const responsePayload = { success: true, data };

    if (canCache) {
      await redisCache.set(subcategoriesKey(category_id), responsePayload, TAXONOMY_TTL);
      console.log(`[Cache] SET  taxonomy:subcategories:${category_id} (TTL ${TAXONOMY_TTL}s)`);
    }

    res.json(responsePayload);
  } catch (error) {
    logger.error('Get subcategories error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching subcategories' });
  }
};

const createSubcategory = async (req, res) => {
  try {
    const { category_id, name, description, slug, display_order, is_active, show_mock_tests_tab, show_previous_papers_tab } = req.body;
    const logoFile = req.file;

    if (!category_id || !name) {
      return res.status(400).json({ success: false, message: 'Category ID and name are required' });
    }

    const category = await prisma.exam_categories.findUnique({ where: { id: category_id }, select: { id: true } });

    if (!category) {
      return res.status(404).json({ success: false, message: 'Parent category not found' });
    }

    const normalizedSlug = slugify(slug || name);
    const uniqueSlug = await ensureUniqueSlug(prisma.exam_subcategories, normalizedSlug);

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
      is_active: is_active !== undefined ? is_active === 'true' || is_active === true : true,
      show_mock_tests_tab: show_mock_tests_tab !== undefined ? show_mock_tests_tab === 'true' || show_mock_tests_tab === true : true,
      show_previous_papers_tab: show_previous_papers_tab !== undefined ? show_previous_papers_tab === 'true' || show_previous_papers_tab === true : true
    };

    let data;
    try {
      data = await prisma.exam_subcategories.create({ data: insertData });
    } catch (error) {
      logger.error('Create subcategory error:', error);
      return res.status(500).json({ success: false, message: 'Failed to create subcategory' });
    }

    await invalidateSubcategoryCache(category_id);
    res.status(201).json({ success: true, data });
  } catch (error) {
    logger.error('Create subcategory error:', error);
    res.status(500).json({ success: false, message: 'Server error while creating subcategory' });
  }
};

const updateSubcategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, slug, display_order, is_active, show_mock_tests_tab, show_previous_papers_tab } = req.body;
    const logoFile = req.file;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Subcategory name is required' });
    }

    const existingSubcategory = await prisma.exam_subcategories.findUnique({
      where: { id },
      select: { category_id: true, slug: true, logo_url: true }
    });

    if (!existingSubcategory) {
      return res.status(404).json({ success: false, message: 'Subcategory not found' });
    }

    let normalizedSlug = slug ? slugify(slug) : slugify(name);
    normalizedSlug = await ensureUniqueSlug(prisma.exam_subcategories, normalizedSlug, {
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

    if (show_mock_tests_tab !== undefined) {
      updateData.show_mock_tests_tab = show_mock_tests_tab === 'true' || show_mock_tests_tab === true;
    }

    if (show_previous_papers_tab !== undefined) {
      updateData.show_previous_papers_tab = show_previous_papers_tab === 'true' || show_previous_papers_tab === true;
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

    let data;
    try {
      data = await prisma.exam_subcategories.update({ where: { id }, data: updateData });
    } catch (error) {
      logger.error('Update subcategory error:', error);
      return res.status(500).json({ success: false, message: 'Failed to update subcategory' });
    }

    await invalidateSubcategoryCache(existingSubcategory.category_id, id);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('Update subcategory error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating subcategory' });
  }
};

const getDifficulties = async (req, res) => {
  try {
    let data;
    try {
      data = await prisma.exam_difficulties.findMany({
        select: { id: true, name: true, slug: true, description: true, level_order: true },
        orderBy: { level_order: 'asc' }
      });
    } catch (error) {
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
    const uniqueSlug = await ensureUniqueSlug(prisma.exam_difficulties, normalizedSlug);

    let data;
    try {
      data = await prisma.exam_difficulties.create({
        data: { name, description, slug: uniqueSlug, level_order: level_order ? parseInt(level_order) : 0 }
      });
    } catch (error) {
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

    const category = await prisma.exam_categories.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true, description: true, logo_url: true, icon: true, display_order: true, is_active: true, created_at: true, updated_at: true }
    });

    if (!category) {
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

    const cacheKey = categorySlugKey(slug);
    const cached = await redisCache.get(cacheKey);
    if (cached) {
      console.log(`[Cache] HIT  taxonomy:category:${slug}`);
      return res.json(cached);
    }
    console.log(`[Cache] MISS taxonomy:category:${slug} — fetching from DB`);

    const category = await prisma.exam_categories.findFirst({
      where: { slug, OR: [{ is_active: true }, { is_active: null }] },
      select: { id: true, name: true, slug: true, description: true, logo_url: true, icon: true }
    });

    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const responsePayload = { success: true, data: category };
    await redisCache.set(cacheKey, responsePayload, TAXONOMY_TTL);
    console.log(`[Cache] SET  taxonomy:category:${slug} (TTL ${TAXONOMY_TTL}s)`);
    res.json(responsePayload);
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

    let data = await prisma.exam_subcategories.findUnique({
      where: { id: identifier },
      select: SUBCATEGORY_DETAIL_SELECT
    }).catch(() => null); // non-UUID identifier throws on the UUID cast — fall through to slug lookup

    if (!data) {
      data = await prisma.exam_subcategories.findFirst({
        where: { slug: identifier },
        select: SUBCATEGORY_DETAIL_SELECT
      });
    }

    if (!data) {
      return res.status(404).json({ success: false, message: 'Subcategory not found' });
    }

    let category = null;
    let categorySlug = null;
    if (data.category_id) {
      const categoryData = await prisma.exam_categories.findUnique({
        where: { id: data.category_id },
        select: { id: true, name: true, slug: true }
      });

      if (categoryData) {
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

    const category = await prisma.exam_categories.findFirst({
      where: { slug, OR: [{ is_active: true }, { is_active: null }] },
      select: { id: true }
    });

    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const offset = (pageNumber - 1) * limitNumber;

    const where = {
      OR: [{ category_id: category.id }, { category: { contains: slug, mode: 'insensitive' } }],
      is_published: true,
      deleted_at: null,
      AND: [{ OR: [{ is_current_affair: false }, { is_current_affair: null }] }]
    };

    if (difficulty) where.difficulty = difficulty;
    if (subcategory) where.subcategory = subcategory;
    if (search) {
      const searchTerm = search.trim();
      where.AND.push({ title: { contains: searchTerm, mode: 'insensitive' } });
    }

    let exams, count;
    try {
      [exams, count] = await Promise.all([
        prisma.exams.findMany({
          where,
          select: {
            id: true, title: true, duration: true, total_marks: true, total_questions: true,
            difficulty: true, status: true, start_date: true, end_date: true, is_free: true,
            logo_url: true, thumbnail_url: true, slug: true, url_path: true, subcategory: true,
            supports_hindi: true
          },
          orderBy: { created_at: 'desc' },
          skip: offset,
          take: limitNumber
        }),
        prisma.exams.count({ where })
      ]);
    } catch (error) {
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

    const category = await prisma.exam_categories.findFirst({
      where: { slug: resolvedCategorySlug, OR: [{ is_active: true }, { is_active: null }] },
      select: { id: true, name: true, slug: true }
    });

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

const EXAM_LISTING_SELECT = {
  id: true, title: true, duration: true, total_marks: true, total_questions: true,
  difficulty: true, status: true, start_date: true, end_date: true, is_free: true,
  logo_url: true, thumbnail_url: true, pdf_url_en: true, pdf_url_hi: true, slug: true,
  url_path: true, exam_type: true, subcategory: true, supports_hindi: true, show_in_mock_tests: true
};

const getExamsBySubcategory = async (req, res) => {
  try {
    const { categorySlug, subcategorySlug } = req.params;
    const resolvedCategorySlug = parseCategorySlug(categorySlug);
    const resolvedSubcategorySlug = parseSubcategorySlug(subcategorySlug);
    const { page = 1, limit = 12, difficulty, search, exam_type } = req.query;
    const pageNumber = Number.parseInt(page, 10) || 1;
    const limitNumber = Math.min(Number.parseInt(limit, 10) || 12, 100);

    const category = await prisma.exam_categories.findFirst({
      where: { slug: resolvedCategorySlug, OR: [{ is_active: true }, { is_active: null }] },
      select: { id: true }
    });

    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const { data: subcategory } = await fetchSubcategoryRecord(category.id, resolvedSubcategorySlug, { id: true }, false);

    if (!subcategory) {
      return res.json({ success: true, data: [], pagination: { page: pageNumber, limit: limitNumber, total: 0, totalPages: 0 } });
    }

    const offset = (pageNumber - 1) * limitNumber;

    const where = {
      subcategory_id: subcategory.id,
      is_published: true,
      deleted_at: null,
      OR: [{ is_current_affair: false }, { is_current_affair: null }]
    };

    if (difficulty) where.difficulty = difficulty;
    if (exam_type) where.exam_type = exam_type;
    if (search) {
      const searchTerm = search.trim();
      where.AND = [{ OR: [{ title: { contains: searchTerm, mode: 'insensitive' } }, { slug: { contains: searchTerm, mode: 'insensitive' } }] }];
    }

    let exams, count;
    try {
      [exams, count] = await Promise.all([
        prisma.exams.findMany({
          where,
          select: EXAM_LISTING_SELECT,
          orderBy: { created_at: 'desc' },
          skip: offset,
          take: limitNumber
        }),
        prisma.exams.count({ where })
      ]);
    } catch (error) {
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

    try {
      // updateMany (not update) so a nonexistent id silently no-ops instead of
      // throwing, matching supabase-js's original behavior of a no-op 0-row update.
      await Promise.all(
        orderedIds.map((id, index) =>
          prisma.exam_subcategories.updateMany({ where: { id }, data: { display_order: index } })
        )
      );
    } catch (error) {
      logger.error('Reorder subcategories error:', error);
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

    const subcategory = await prisma.exam_subcategories.findFirst({
      where: { slug, OR: [{ is_active: true }, { is_active: null }] },
      select: SUBCATEGORY_DETAIL_SELECT
    });

    if (!subcategory) {
      return res.status(404).json({ success: false, message: 'Subcategory not found' });
    }

    let category = null;
    if (subcategory.category_id) {
      const categoryData = await prisma.exam_categories.findUnique({
        where: { id: subcategory.category_id },
        select: { id: true, name: true, slug: true }
      });
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

    const subcategory = await prisma.exam_subcategories.findFirst({
      where: { slug, OR: [{ is_active: true }, { is_active: null }] },
      select: { id: true }
    });

    if (!subcategory) {
      return res.json({ success: true, data: [], pagination: { page: pageNumber, limit: limitNumber, total: 0, totalPages: 0 } });
    }

    const offset = (pageNumber - 1) * limitNumber;

    const where = {
      subcategory_id: subcategory.id,
      is_published: true,
      deleted_at: null,
      OR: [{ is_current_affair: false }, { is_current_affair: null }]
    };

    if (difficulty) where.difficulty = difficulty;
    if (exam_type) where.exam_type = exam_type;
    if (search) {
      const searchTerm = search.trim();
      where.AND = [{ OR: [{ title: { contains: searchTerm, mode: 'insensitive' } }, { slug: { contains: searchTerm, mode: 'insensitive' } }] }];
    }

    let exams, count;
    try {
      [exams, count] = await Promise.all([
        prisma.exams.findMany({
          where,
          select: EXAM_LISTING_SELECT,
          orderBy: { created_at: 'desc' },
          skip: offset,
          take: limitNumber
        }),
        prisma.exams.count({ where })
      ]);
    } catch (error) {
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

      const category = await prisma.exam_categories.findFirst({
        where: { slug: candidateCatSlug, OR: [{ is_active: true }, { is_active: null }] },
        select: { id: true, name: true, slug: true }
      });

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
