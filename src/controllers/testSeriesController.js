const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { slugify, ensureUniqueSlug } = require('../utils/slugify');
const { uploadFile, deleteFile, extractKeyFromUrl } = require('../services/uploadService');
const { redisCache, CACHE_TTL, buildCacheKey } = require('../utils/redisCache');

const invalidateTestSeriesCaches = async (testSeriesId) => {
  await redisCache.deleteByPattern(buildCacheKey('test_series_list', '*'));

  if (testSeriesId) {
    await redisCache.del(buildCacheKey('test_series_stats', testSeriesId));
  }
};

// test_series.price is a Decimal column — Prisma returns Decimal.js objects that
// serialize to JSON strings, not plain numbers, unlike supabase-js. Normalize on the
// way out so the API contract (price as a JSON number) is unchanged.
const normalizeTestSeries = (series) => {
  if (!series) return series;
  return {
    ...series,
    price: series.price !== null && series.price !== undefined ? Number(series.price) : series.price
  };
};

const fetchCategoryDetails = async ({ id, slug }) => {
  if (!id && !slug) return null;
  const normalizedSlug = slug ? slugify(slug) : null;
  const where = id ? { id } : { slug: normalizedSlug };
  const data = await prisma.exam_categories.findFirst({
    where,
    select: { id: true, name: true, slug: true, logo_url: true }
  });
  return data || null;
};

const hydrateSeriesCategory = async (series, fallbackCategory = null) => {
  if (!series) return;
  const fallbackSlug = fallbackCategory?.slug ? slugify(fallbackCategory.slug) : null;
  const preferredCategoryId = series.category_id || fallbackCategory?.id || null;
  const preferredCategorySlug = series.category?.slug || fallbackSlug || null;
  const hasLogo = series.category && series.category.logo_url;
  if (hasLogo) return;
  if (!preferredCategoryId && !preferredCategorySlug) return;
  const categoryDetails = await fetchCategoryDetails({ id: preferredCategoryId, slug: preferredCategorySlug });
  if (categoryDetails) {
    series.category = categoryDetails;
    series.category_id = categoryDetails.id;
  }
};

// Batch load all metadata to avoid N+1 queries
const batchLoadTestSeriesMetadata = async () => {
  const cacheKey = buildCacheKey('test_series_metadata');
  const cached = await redisCache.get(cacheKey);
  if (cached) return cached;

  const [categories, subcategories, difficulties] = await Promise.all([
    prisma.exam_categories.findMany({ select: { id: true, name: true, slug: true, logo_url: true } }),
    prisma.exam_subcategories.findMany({ select: { id: true, name: true, slug: true, category_id: true } }),
    prisma.exam_difficulties.findMany({ select: { id: true, name: true, slug: true } }),
  ]);

  const metadata = {
    categories,
    subcategories,
    difficulties,
    categoriesMap: {},
    subcategoriesMap: {},
    difficultiesMap: {},
  };

  metadata.categories.forEach(cat => {
    metadata.categoriesMap[cat.id] = cat;
    metadata.categoriesMap[cat.slug] = cat;
  });
  metadata.subcategories.forEach(sub => {
    metadata.subcategoriesMap[sub.id] = sub;
    metadata.subcategoriesMap[sub.slug] = sub;
  });
  metadata.difficulties.forEach(diff => {
    metadata.difficultiesMap[diff.id] = diff;
    metadata.difficultiesMap[diff.slug] = diff;
  });

  await redisCache.set(cacheKey, metadata, CACHE_TTL.CATEGORIES);
  return metadata;
};

// Batch load exam counts and user counts for test series
const batchLoadTestSeriesStats = async (testSeriesIds) => {
  if (!testSeriesIds.length) return {};

  const cacheKeys = testSeriesIds.map(id => buildCacheKey('test_series_stats', id));
  const cachedStats = await redisCache.mget(cacheKeys);

  const uncachedIds = [];
  const statsMap = {};

  testSeriesIds.forEach((id, index) => {
    const cached = cachedStats[cacheKeys[index]];
    if (cached) {
      statsMap[id] = cached;
    } else {
      uncachedIds.push(id);
    }
  });

  if (uncachedIds.length > 0) {
    const examCounts = await prisma.exams.findMany({
      where: { test_series_id: { in: uncachedIds }, is_published: true, deleted_at: null },
      select: { test_series_id: true, id: true, is_free: true, supports_hindi: true }
    });

    const examIds = examCounts.map(e => e.id);
    const userCounts = {};

    if (examIds.length > 0) {
      const attempts = await prisma.exam_attempts.findMany({
        where: { exam_id: { in: examIds } },
        select: { exam_id: true, user_id: true }
      });

      const examUserCounts = {};
      attempts.forEach(attempt => {
        if (!examUserCounts[attempt.exam_id]) {
          examUserCounts[attempt.exam_id] = new Set();
        }
        examUserCounts[attempt.exam_id].add(attempt.user_id);
      });

      examCounts.forEach(exam => {
        const tsId = exam.test_series_id;
        if (!userCounts[tsId]) userCounts[tsId] = new Set();
        const examUsers = examUserCounts[exam.id];
        if (examUsers) examUsers.forEach(uid => userCounts[tsId].add(uid));
      });

      Object.keys(userCounts).forEach(sid => {
        userCounts[sid] = userCounts[sid].size;
      });
    }

    uncachedIds.forEach(seriesId => {
      const seriesExams = examCounts.filter(e => e.test_series_id === seriesId);
      const supportsHindi = seriesExams.some(e => e.supports_hindi);
      const languages = supportsHindi ? ['English', 'Hindi'] : ['English'];
      statsMap[seriesId] = {
        total_tests: seriesExams.length,
        free_tests: seriesExams.filter(e => e.is_free).length,
        user_count: userCounts[seriesId] || 0,
        languages,
        languages_text: languages.join(', '),
      };
    });

    const cacheEntries = uncachedIds.map(id => [buildCacheKey('test_series_stats', id), statsMap[id]]);
    await redisCache.mset(cacheEntries, CACHE_TTL.TEST_SERIES);
  }

  return statsMap;
};

const resolveFilteredTestSeriesIds = async ({ metadata, category, subcategory, difficulty, is_published }) => {
  const hasTaxonomyFilters = Boolean(category || subcategory || difficulty);
  if (!hasTaxonomyFilters) return null;

  const categoryData = category ? metadata.categoriesMap[category] : null;
  const subcategoryData = subcategory ? metadata.subcategoriesMap[subcategory] : null;
  const difficultyData = difficulty ? metadata.difficultiesMap[difficulty] : null;

  if ((category && !categoryData) || (subcategory && !subcategoryData) || (difficulty && !difficultyData)) {
    return [];
  }

  const directWhere = { deleted_at: null };
  if (categoryData) directWhere.category_id = categoryData.id;
  if (subcategoryData) directWhere.subcategory_id = subcategoryData.id;
  if (difficultyData) directWhere.difficulty_id = difficultyData.id;
  if (is_published !== undefined && is_published !== '') {
    directWhere.is_published = is_published === 'true';
  }

  const examWhere = { test_series_id: { not: null }, deleted_at: null };
  if (categoryData) examWhere.category_id = categoryData.id;
  if (subcategoryData) examWhere.subcategory_id = subcategoryData.id;
  if (difficultyData) examWhere.difficulty_id = difficultyData.id;
  if (is_published !== undefined && is_published !== '') {
    examWhere.is_published = is_published === 'true';
  }

  const [directMatches, examMatches] = await Promise.all([
    prisma.test_series.findMany({ where: directWhere, select: { id: true } }),
    prisma.exams.findMany({ where: examWhere, select: { test_series_id: true } }),
  ]);

  return Array.from(new Set([
    ...directMatches.map(series => series.id),
    ...examMatches.map(exam => exam.test_series_id).filter(Boolean),
  ]));
};

const getAllTestSeries = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, category, subcategory, difficulty, is_published, exclude_hidden } = req.query;

    const pageNumber = Math.max(1, parseInt(page, 10));
    const limitNumber = Math.min(50, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNumber - 1) * limitNumber;

    const cacheKey = buildCacheKey(
      'test_series_list', pageNumber, limitNumber,
      search || '', category || '', subcategory || '', difficulty || '', is_published || '', exclude_hidden || ''
    );

    const cachedResponse = await redisCache.get(cacheKey);
    if (cachedResponse && Array.isArray(cachedResponse.data) && cachedResponse.data.length > 0) {
      return res.json(cachedResponse);
    }

    const metadata = await batchLoadTestSeriesMetadata();

    const filteredSeriesIds = await resolveFilteredTestSeriesIds({
      metadata,
      category,
      subcategory,
      difficulty,
      is_published,
    });

    if (Array.isArray(filteredSeriesIds) && filteredSeriesIds.length === 0) {
      const emptyResponse = {
        data: [],
        total: 0,
        page: pageNumber,
        limit: limitNumber,
        totalPages: 0,
      };

      await redisCache.set(cacheKey, emptyResponse, CACHE_TTL.TEST_SERIES);
      return res.json(emptyResponse);
    }

    const where = { deleted_at: null };

    if (Array.isArray(filteredSeriesIds)) {
      where.id = { in: filteredSeriesIds };
    }

    if (search) {
      const searchTerm = search.trim();
      where.OR = [
        { title: { contains: searchTerm, mode: 'insensitive' } },
        { description: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    if (is_published !== undefined && is_published !== '') {
      where.is_published = is_published === 'true';
    }

    // Public listings (e.g. /mock-test-series) pass exclude_hidden=true so that
    // admin-hidden series (like the quizzes container series) don't appear as cards.
    // Admin surfaces omit the param and still see every series.
    if (exclude_hidden === 'true') {
      where.hidden_from_listing = false;
    }

    let testSeries, count;
    try {
      [testSeries, count] = await Promise.all([
        prisma.test_series.findMany({
          where,
          select: {
            id: true, title: true, description: true, category_id: true, subcategory_id: true,
            difficulty_id: true, logo_url: true, slug: true, is_published: true,
            hidden_from_listing: true, display_order: true, created_at: true, updated_at: true
          },
          orderBy: [{ display_order: 'asc' }, { created_at: 'desc' }],
          skip: offset,
          take: limitNumber
        }),
        prisma.test_series.count({ where })
      ]);
    } catch (error) {
      logger.error('Error fetching test series:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch test series', error: error.message });
    }

    const testSeriesIds = testSeries.map(s => s.id);
    const statsMap = await batchLoadTestSeriesStats(testSeriesIds);

    const enrichedTestSeries = testSeries.map(series => ({
      ...series,
      category: series.category_id ? metadata.categoriesMap[series.category_id] : null,
      subcategory: series.subcategory_id ? metadata.subcategoriesMap[series.subcategory_id] : null,
      difficulty: series.difficulty_id ? metadata.difficultiesMap[series.difficulty_id] : null,
      ...(statsMap[series.id] || {}),
    }));

    const response = {
      data: enrichedTestSeries,
      total: count || 0,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil((count || 0) / limitNumber),
    };

    await redisCache.set(cacheKey, response, CACHE_TTL.TEST_SERIES);
    res.json(response);
  } catch (error) {
    logger.error('Error in getAllTestSeries:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

const getTestSeriesById = async (req, res) => {
  try {
    const { id } = req.params;

    let testSeriesRow;
    try {
      testSeriesRow = await prisma.test_series.findFirst({
        where: { id, deleted_at: null },
        include: {
          exam_categories: { select: { id: true, name: true, slug: true, logo_url: true } },
          exam_subcategories: { select: { id: true, name: true, slug: true } },
          exam_difficulties: { select: { id: true, name: true, slug: true } },
        }
      });
    } catch (error) {
      logger.error('Error fetching test series:', error);
      return res.status(404).json({ error: 'Test series not found' });
    }

    if (!testSeriesRow) {
      logger.error('Error fetching test series: not found');
      return res.status(404).json({ error: 'Test series not found' });
    }

    const { exam_categories, exam_subcategories, exam_difficulties, ...rest } = testSeriesRow;
    const testSeries = normalizeTestSeries({
      ...rest,
      category: exam_categories,
      subcategory: exam_subcategories,
      difficulty: exam_difficulties
    });

    const sections = await prisma.test_series_sections.findMany({
      where: { test_series_id: id },
      orderBy: { display_order: 'asc' }
    });

    testSeries.sections = sections;

    // Batch-load topics for every section in one query instead of one query per
    // section (the original supabase code did a per-section loop — N+1 eliminated
    // here, same output shape).
    const sectionIds = sections.map(s => s.id);
    const allTopics = sectionIds.length
      ? await prisma.test_series_topics.findMany({
          where: { section_id: { in: sectionIds } },
          orderBy: { display_order: 'asc' }
        })
      : [];
    testSeries.sections.forEach(section => {
      section.topics = allTopics.filter(t => t.section_id === section.id);
    });

    const exams = await prisma.exams.findMany({
      where: { test_series_id: id, deleted_at: null },
      select: {
        id: true, title: true, duration: true, total_marks: true, total_questions: true,
        status: true, exam_date: true, is_free: true, logo_url: true, thumbnail_url: true,
        test_series_section_id: true, test_series_topic_id: true, display_order: true,
        slug: true, url_path: true, category: true, category_id: true, subcategory: true,
        subcategory_id: true, difficulty: true, difficulty_id: true, is_published: true,
        allow_anytime: true, start_date: true, end_date: true, supports_hindi: true,
        is_premium: true, pass_percentage: true, negative_marking: true, negative_mark_value: true,
        created_at: true, updated_at: true, exam_type: true, show_in_mock_tests: true
      },
      orderBy: [{ display_order: 'asc' }, { exam_date: 'asc' }]
    });

    testSeries.exams = exams;

    const fallbackCategorySource = exams.find(e => e.category_id || e.category) || null;
    const fallbackCategory = fallbackCategorySource
      ? { id: fallbackCategorySource.category_id, slug: fallbackCategorySource.category }
      : null;
    await hydrateSeriesCategory(testSeries, fallbackCategory);

    const examIds = exams.map(e => e.id);
    let attemptCount = 0;
    if (examIds.length > 0) {
      attemptCount = await prisma.exam_attempts.count({ where: { exam_id: { in: examIds } } });
    }
    testSeries.total_attempts = attemptCount;

    res.json(testSeries);
  } catch (error) {
    logger.error('Error in getTestSeriesById:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getTestSeriesBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    let testSeriesRow;
    try {
      testSeriesRow = await prisma.test_series.findFirst({
        where: { slug, is_published: true, deleted_at: null },
        include: {
          exam_categories: { select: { id: true, name: true, slug: true, logo_url: true } },
          exam_subcategories: { select: { id: true, name: true, slug: true } },
          exam_difficulties: { select: { id: true, name: true, slug: true } },
        }
      });
    } catch (error) {
      logger.error('Error fetching test series by slug:', error);
      return res.status(404).json({ error: 'Test series not found' });
    }

    if (!testSeriesRow) {
      logger.error('Error fetching test series by slug: not found');
      return res.status(404).json({ error: 'Test series not found' });
    }

    const { exam_categories, exam_subcategories, exam_difficulties, ...rest } = testSeriesRow;
    const testSeries = normalizeTestSeries({
      ...rest,
      category: exam_categories,
      subcategory: exam_subcategories,
      difficulty: exam_difficulties
    });

    await hydrateSeriesCategory(testSeries);

    const sections = await prisma.test_series_sections.findMany({
      where: { test_series_id: testSeries.id },
      orderBy: { display_order: 'asc' }
    });

    testSeries.sections = sections;

    const sectionIds = sections.map(s => s.id);
    const allTopics = sectionIds.length
      ? await prisma.test_series_topics.findMany({
          where: { section_id: { in: sectionIds } },
          orderBy: { display_order: 'asc' }
        })
      : [];
    testSeries.sections.forEach(section => {
      section.topics = allTopics.filter(t => t.section_id === section.id);
    });

    const safeExams = await prisma.exams.findMany({
      where: { test_series_id: testSeries.id, deleted_at: null },
      select: {
        id: true, title: true, duration: true, total_marks: true, total_questions: true,
        status: true, exam_date: true, is_free: true, logo_url: true, thumbnail_url: true,
        test_series_section_id: true, test_series_topic_id: true, display_order: true,
        slug: true, url_path: true, category: true, category_id: true, subcategory: true,
        subcategory_id: true, difficulty: true, difficulty_id: true, is_published: true,
        allow_anytime: true, start_date: true, end_date: true, supports_hindi: true,
        is_premium: true, pass_percentage: true, negative_marking: true, negative_mark_value: true,
        created_at: true, updated_at: true, exam_type: true, show_in_mock_tests: true,
        exam_categories: { select: { logo_url: true, icon: true } }
      },
      orderBy: [{ display_order: 'asc' }, { exam_date: 'asc' }]
    });

    testSeries.exams = safeExams;

    const fallbackCategorySource = safeExams.find(e => e.category_id || e.category) || null;
    const fallbackCategory = fallbackCategorySource
      ? { id: fallbackCategorySource.category_id, slug: fallbackCategorySource.category }
      : null;
    await hydrateSeriesCategory(testSeries, fallbackCategory);

    let attemptCount = 0;
    if (safeExams.length > 0) {
      attemptCount = await prisma.exam_attempts.count({ where: { exam_id: { in: safeExams.map(e => e.id) } } });
    }
    testSeries.total_attempts = attemptCount;

    res.json(testSeries);
  } catch (error) {
    logger.error('Error in getTestSeriesBySlug:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const createTestSeries = async (req, res) => {
  try {
    const {
      title, slug: customSlug, description, category_id, subcategory_id, difficulty_id,
      is_published, is_free, price, display_order, logo_url, thumbnail_url, hidden_from_listing,
    } = req.body;

    if (!title) return res.status(400).json({ error: 'Title is required' });

    // Allow an admin-provided custom slug, otherwise derive it from the title.
    let baseSlug;
    if (customSlug !== undefined && customSlug !== null && String(customSlug).trim() !== '') {
      baseSlug = slugify(customSlug);
      if (!baseSlug) {
        return res.status(400).json({
          error: 'Invalid slug',
          message: 'The slug must contain at least one letter or number.',
        });
      }
    } else {
      baseSlug = slugify(title);
    }
    const slug = await ensureUniqueSlug(prisma.test_series, baseSlug);

    let testSeries;
    try {
      testSeries = await prisma.test_series.create({
        data: {
          title, description, slug, category_id, subcategory_id, difficulty_id,
          is_published: is_published || false,
          is_free: is_free !== undefined ? is_free : true,
          price: price || 0,
          display_order: display_order || 0,
          logo_url, thumbnail_url,
          hidden_from_listing: hidden_from_listing || false,
        }
      });
    } catch (error) {
      logger.error('Error creating test series:', error);
      return res.status(500).json({ error: 'Failed to create test series' });
    }

    await invalidateTestSeriesCaches(testSeries.id);
    res.status(201).json(normalizeTestSeries(testSeries));
  } catch (error) {
    logger.error('Error in createTestSeries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateTestSeries = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title, slug, description, category_id, subcategory_id, difficulty_id,
      is_published, is_free, price, display_order, logo_url, thumbnail_url, hidden_from_listing,
    } = req.body;

    const updateData = { updated_at: new Date() };

    if (title !== undefined) updateData.title = title;

    // An explicit `slug` lets the admin set a custom, stable public URL.
    // It takes precedence and is validated for format + uniqueness so that
    // renaming the title never silently changes a curated URL.
    if (slug !== undefined) {
      const desiredSlug = slugify(slug);
      if (!desiredSlug) {
        return res.status(400).json({
          error: 'Invalid slug',
          message: 'The slug must contain at least one letter or number.',
        });
      }

      let slugConflict;
      try {
        slugConflict = await prisma.test_series.findFirst({
          where: { slug: desiredSlug, id: { not: id } },
          select: { id: true }
        });
      } catch (error) {
        logger.error('Error checking slug uniqueness:', error);
        return res.status(500).json({ error: 'Failed to validate slug' });
      }

      if (slugConflict) {
        return res.status(409).json({
          error: 'Slug already in use',
          message: `The slug "${desiredSlug}" is already used by another test series. Please choose a different one.`,
        });
      }

      updateData.slug = desiredSlug;
    }
    if (description !== undefined) updateData.description = description;
    if (category_id !== undefined) updateData.category_id = category_id;
    if (subcategory_id !== undefined) updateData.subcategory_id = subcategory_id;
    if (difficulty_id !== undefined) updateData.difficulty_id = difficulty_id;
    if (is_published !== undefined) updateData.is_published = is_published;
    if (is_free !== undefined) updateData.is_free = is_free;
    if (price !== undefined) updateData.price = price;
    if (display_order !== undefined) updateData.display_order = display_order;
    if (logo_url !== undefined) updateData.logo_url = logo_url;
    if (thumbnail_url !== undefined) updateData.thumbnail_url = thumbnail_url;
    if (hidden_from_listing !== undefined) updateData.hidden_from_listing = hidden_from_listing;

    let testSeries;
    try {
      testSeries = await prisma.test_series.update({ where: { id }, data: updateData });
    } catch (error) {
      logger.error('Error updating test series:', error);
      return res.status(500).json({ error: 'Failed to update test series' });
    }

    await invalidateTestSeriesCaches(id);
    res.json(normalizeTestSeries(testSeries));
  } catch (error) {
    logger.error('Error in updateTestSeries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteTestSeries = async (req, res) => {
  try {
    const { id } = req.params;

    try {
      await prisma.test_series.update({ where: { id }, data: { deleted_at: new Date() } });
    } catch (error) {
      logger.error('Error deleting test series:', error);
      return res.status(500).json({ error: 'Failed to delete test series' });
    }

    await invalidateTestSeriesCaches(id);
    res.json({ message: 'Test series deleted successfully' });
  } catch (error) {
    logger.error('Error in deleteTestSeries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const createSection = async (req, res) => {
  try {
    const { test_series_id, name, description, display_order } = req.body;
    if (!test_series_id || !name) return res.status(400).json({ error: 'Test series ID and name are required' });

    let section;
    try {
      section = await prisma.test_series_sections.create({
        data: { test_series_id, name, description, display_order: display_order || 0 }
      });
    } catch (error) {
      logger.error('Error creating section:', error);
      return res.status(500).json({ error: 'Failed to create section' });
    }
    res.status(201).json(section);
  } catch (error) {
    logger.error('Error in createSection:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateSection = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, display_order } = req.body;
    const updateData = { updated_at: new Date() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (display_order !== undefined) updateData.display_order = display_order;

    let section;
    try {
      section = await prisma.test_series_sections.update({ where: { id }, data: updateData });
    } catch (error) {
      logger.error('Error updating section:', error);
      return res.status(500).json({ error: 'Failed to update section' });
    }
    res.json(section);
  } catch (error) {
    logger.error('Error in updateSection:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteSection = async (req, res) => {
  try {
    const { id } = req.params;
    try {
      await prisma.test_series_sections.delete({ where: { id } });
    } catch (error) {
      logger.error('Error deleting section:', error);
      return res.status(500).json({ error: 'Failed to delete section' });
    }
    res.json({ message: 'Section deleted successfully' });
  } catch (error) {
    logger.error('Error in deleteSection:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const createTopic = async (req, res) => {
  try {
    const { section_id, name, description, display_order } = req.body;
    if (!section_id || !name) return res.status(400).json({ error: 'Section ID and name are required' });

    let topic;
    try {
      topic = await prisma.test_series_topics.create({
        data: { section_id, name, description, display_order: display_order || 0 }
      });
    } catch (error) {
      logger.error('Error creating topic:', error);
      return res.status(500).json({ error: 'Failed to create topic' });
    }
    res.status(201).json(topic);
  } catch (error) {
    logger.error('Error in createTopic:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateTopic = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, display_order } = req.body;
    const updateData = { updated_at: new Date() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (display_order !== undefined) updateData.display_order = display_order;

    let topic;
    try {
      topic = await prisma.test_series_topics.update({ where: { id }, data: updateData });
    } catch (error) {
      logger.error('Error updating topic:', error);
      return res.status(500).json({ error: 'Failed to update topic' });
    }
    res.json(topic);
  } catch (error) {
    logger.error('Error in updateTopic:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteTopic = async (req, res) => {
  try {
    const { id } = req.params;
    try {
      await prisma.test_series_topics.delete({ where: { id } });
    } catch (error) {
      logger.error('Error deleting topic:', error);
      return res.status(500).json({ error: 'Failed to delete topic' });
    }
    res.json({ message: 'Topic deleted successfully' });
  } catch (error) {
    logger.error('Error in deleteTopic:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getSectionsByTestSeries = async (req, res) => {
  try {
    const { test_series_id } = req.params;
    let sections;
    try {
      sections = await prisma.test_series_sections.findMany({
        where: { test_series_id },
        orderBy: { display_order: 'asc' }
      });
    } catch (error) {
      logger.error('Error fetching sections:', error);
      return res.status(500).json({ error: 'Failed to fetch sections' });
    }
    res.json(sections);
  } catch (error) {
    logger.error('Error in getSectionsByTestSeries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getTopicsBySection = async (req, res) => {
  try {
    const { section_id } = req.params;
    let topics;
    try {
      topics = await prisma.test_series_topics.findMany({
        where: { section_id },
        orderBy: { display_order: 'asc' }
      });
    } catch (error) {
      logger.error('Error fetching topics:', error);
      return res.status(500).json({ error: 'Failed to fetch topics' });
    }
    res.json(topics);
  } catch (error) {
    logger.error('Error in getTopicsBySection:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const reorderSections = async (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ success: false, message: 'orderedIds must be a non-empty array' });
    }

    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    const validIds = orderedIds.filter(id => uuidRegex.test(id));

    if (validIds.length === 0) {
      return res.json({ success: true, message: 'No saved sections to reorder' });
    }

    try {
      // updateMany (not update) so a nonexistent id silently no-ops instead of
      // throwing, matching supabase-js's original behavior of a no-op 0-row update.
      await Promise.all(
        validIds.map((id, index) =>
          prisma.test_series_sections.updateMany({ where: { id }, data: { display_order: index } })
        )
      );
    } catch (error) {
      logger.error('Reorder sections error:', error);
      return res.status(500).json({ success: false, message: 'Failed to reorder sections' });
    }
    await invalidateTestSeriesCaches();
    res.json({ success: true, message: 'Sections reordered successfully' });
  } catch (error) {
    logger.error('Reorder sections error:', error);
    res.status(500).json({ success: false, message: 'Server error while reordering sections' });
  }
};

const reorderTopics = async (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ success: false, message: 'orderedIds must be a non-empty array' });
    }

    try {
      await Promise.all(
        orderedIds.map((id, index) =>
          prisma.test_series_topics.updateMany({ where: { id }, data: { display_order: index } })
        )
      );
    } catch (error) {
      logger.error('Reorder topics error:', error);
      return res.status(500).json({ success: false, message: 'Failed to reorder topics' });
    }
    await invalidateTestSeriesCaches();
    res.json({ success: true, message: 'Topics reordered successfully' });
  } catch (error) {
    logger.error('Reorder topics error:', error);
    res.status(500).json({ success: false, message: 'Server error while reordering topics' });
  }
};

const reorderExams = async (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ success: false, message: 'orderedIds must be a non-empty array' });
    }

    try {
      await Promise.all(
        orderedIds.map((id, index) =>
          prisma.exams.updateMany({ where: { id }, data: { display_order: index } })
        )
      );
    } catch (error) {
      logger.error('Reorder exams error:', error);
      return res.status(500).json({ success: false, message: 'Failed to reorder exams' });
    }
    await invalidateTestSeriesCaches();
    res.json({ success: true, message: 'Exams reordered successfully' });
  } catch (error) {
    logger.error('Reorder exams error:', error);
    res.status(500).json({ success: false, message: 'Server error while reordering exams' });
  }
};

// Reorders the test series cards shown on the public /mock-test-series page.
// orderedIds is the full list of series ids in the desired display order.
const reorderTestSeries = async (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ success: false, message: 'orderedIds must be a non-empty array' });
    }

    try {
      await Promise.all(
        orderedIds.map((id, index) =>
          prisma.test_series.updateMany({ where: { id }, data: { display_order: index } })
        )
      );
    } catch (error) {
      logger.error('Reorder test series error:', error);
      return res.status(500).json({ success: false, message: 'Failed to reorder test series' });
    }
    await invalidateTestSeriesCaches();
    res.json({ success: true, message: 'Test series reordered successfully' });
  } catch (error) {
    logger.error('Reorder test series error:', error);
    res.status(500).json({ success: false, message: 'Server error while reordering test series' });
  }
};

const uploadTestSeriesLogo = async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const testSeries = await prisma.test_series.findUnique({ where: { id }, select: { id: true, logo_url: true } });
    if (!testSeries) return res.status(404).json({ error: 'Test series not found' });

    if (testSeries.logo_url) {
      const oldKey = extractKeyFromUrl(testSeries.logo_url);
      if (oldKey) {
        try { await deleteFile(oldKey); } catch (e) { logger.warn('Failed to delete old logo:', e); }
      }
    }

    const uploadResult = await uploadFile(file, 'test-series/logos');

    let updatedSeries;
    try {
      updatedSeries = await prisma.test_series.update({
        where: { id },
        data: { logo_url: uploadResult.url, updated_at: new Date() }
      });
    } catch (error) {
      logger.error('Error updating test series logo:', error);
      return res.status(500).json({ error: 'Failed to update test series logo' });
    }
    await invalidateTestSeriesCaches(id);
    res.json({ success: true, logo_url: uploadResult.url, test_series: normalizeTestSeries(updatedSeries) });
  } catch (error) {
    logger.error('Error uploading test series logo:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const uploadTestSeriesThumbnail = async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const testSeries = await prisma.test_series.findUnique({ where: { id }, select: { id: true, thumbnail_url: true } });
    if (!testSeries) return res.status(404).json({ error: 'Test series not found' });

    if (testSeries.thumbnail_url) {
      const oldKey = extractKeyFromUrl(testSeries.thumbnail_url);
      if (oldKey) {
        try { await deleteFile(oldKey); } catch (e) { logger.warn('Failed to delete old thumbnail:', e); }
      }
    }

    const uploadResult = await uploadFile(file, 'test-series/thumbnails');

    let updatedSeries;
    try {
      updatedSeries = await prisma.test_series.update({
        where: { id },
        data: { thumbnail_url: uploadResult.url, updated_at: new Date() }
      });
    } catch (error) {
      logger.error('Error updating test series thumbnail:', error);
      return res.status(500).json({ error: 'Failed to update test series thumbnail' });
    }
    await invalidateTestSeriesCaches(id);
    res.json({ success: true, thumbnail_url: uploadResult.url, test_series: normalizeTestSeries(updatedSeries) });
  } catch (error) {
    logger.error('Error uploading test series thumbnail:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteTestSeriesLogo = async (req, res) => {
  try {
    const { id } = req.params;
    const testSeries = await prisma.test_series.findUnique({ where: { id }, select: { id: true, logo_url: true } });
    if (!testSeries) return res.status(404).json({ error: 'Test series not found' });
    if (!testSeries.logo_url) return res.status(400).json({ error: 'No logo to delete' });

    const fileKey = extractKeyFromUrl(testSeries.logo_url);
    if (fileKey) {
      try { await deleteFile(fileKey); } catch (e) { logger.warn('Failed to delete logo file:', e); }
    }

    let updatedSeries;
    try {
      updatedSeries = await prisma.test_series.update({
        where: { id },
        data: { logo_url: null, updated_at: new Date() }
      });
    } catch (error) {
      logger.error('Error removing test series logo:', error);
      return res.status(500).json({ error: 'Failed to remove test series logo' });
    }
    await invalidateTestSeriesCaches(id);
    res.json({ success: true, message: 'Logo deleted successfully', test_series: normalizeTestSeries(updatedSeries) });
  } catch (error) {
    logger.error('Error deleting test series logo:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteTestSeriesThumbnail = async (req, res) => {
  try {
    const { id } = req.params;
    const testSeries = await prisma.test_series.findUnique({ where: { id }, select: { id: true, thumbnail_url: true } });
    if (!testSeries) return res.status(404).json({ error: 'Test series not found' });
    if (!testSeries.thumbnail_url) return res.status(400).json({ error: 'No thumbnail to delete' });

    const fileKey = extractKeyFromUrl(testSeries.thumbnail_url);
    if (fileKey) {
      try { await deleteFile(fileKey); } catch (e) { logger.warn('Failed to delete thumbnail file:', e); }
    }

    let updatedSeries;
    try {
      updatedSeries = await prisma.test_series.update({
        where: { id },
        data: { thumbnail_url: null, updated_at: new Date() }
      });
    } catch (error) {
      logger.error('Error removing test series thumbnail:', error);
      return res.status(500).json({ error: 'Failed to remove test series thumbnail' });
    }
    await invalidateTestSeriesCaches(id);
    res.json({ success: true, message: 'Thumbnail deleted successfully', test_series: normalizeTestSeries(updatedSeries) });
  } catch (error) {
    logger.error('Error deleting test series thumbnail:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getAllTestSeries,
  getTestSeriesById,
  getTestSeriesBySlug,
  createTestSeries,
  updateTestSeries,
  deleteTestSeries,
  createSection,
  updateSection,
  deleteSection,
  createTopic,
  updateTopic,
  deleteTopic,
  getSectionsByTestSeries,
  getTopicsBySection,
  reorderSections,
  reorderTopics,
  reorderExams,
  reorderTestSeries,
  uploadTestSeriesLogo,
  uploadTestSeriesThumbnail,
  deleteTestSeriesLogo,
  deleteTestSeriesThumbnail,
};
