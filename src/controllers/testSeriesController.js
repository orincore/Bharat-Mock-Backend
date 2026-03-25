const supabase = require('../config/database');
const logger = require('../config/logger');
const { slugify, ensureUniqueSlug } = require('../utils/slugify');
const { uploadFile, deleteFile, extractKeyFromUrl } = require('../services/uploadService');
const { redisCache, CACHE_TTL, buildCacheKey } = require('../utils/redisCache');

const fetchCategoryDetails = async ({ id, slug }) => {
  if (!id && !slug) return null;
  const normalizedSlug = slug ? slugify(slug) : null;
  let query = supabase.from('exam_categories').select('id, name, slug, logo_url').limit(1);
  if (id) {
    query = query.eq('id', id);
  } else {
    query = query.eq('slug', normalizedSlug);
  }
  const { data } = await query.single();
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

  const [categoriesResult, subcategoriesResult, difficultiesResult] = await Promise.all([
    supabase.from('exam_categories').select('id, name, slug, logo_url'),
    supabase.from('exam_subcategories').select('id, name, slug, category_id'),
    supabase.from('exam_difficulties').select('id, name, slug'),
  ]);

  const metadata = {
    categories: categoriesResult.data || [],
    subcategories: subcategoriesResult.data || [],
    difficulties: difficultiesResult.data || [],
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
    const { data: examCounts } = await supabase
      .from('exams')
      .select('test_series_id, id, is_free, supports_hindi')
      .in('test_series_id', uncachedIds)
      .eq('is_published', true)
      .is('deleted_at', null);

    const examIds = examCounts?.map(e => e.id) || [];
    const userCounts = {};

    if (examIds.length > 0) {
      const { data: attempts } = await supabase
        .from('exam_attempts')
        .select('exam_id, user_id')
        .in('exam_id', examIds);

      const examUserCounts = {};
      attempts?.forEach(attempt => {
        if (!examUserCounts[attempt.exam_id]) {
          examUserCounts[attempt.exam_id] = new Set();
        }
        examUserCounts[attempt.exam_id].add(attempt.user_id);
      });

      examCounts?.forEach(exam => {
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
      const seriesExams = examCounts?.filter(e => e.test_series_id === seriesId) || [];
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

const getAllTestSeries = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, category, subcategory, difficulty, is_published } = req.query;

    const pageNumber = Math.max(1, parseInt(page, 10));
    const limitNumber = Math.min(50, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNumber - 1) * limitNumber;

    const cacheKey = buildCacheKey(
      'test_series_list', pageNumber, limitNumber,
      search || '', category || '', subcategory || '', difficulty || '', is_published || ''
    );

    const cachedResponse = await redisCache.get(cacheKey);
    if (cachedResponse) return res.json(cachedResponse);

    const metadata = await batchLoadTestSeriesMetadata();

    let query = supabase
      .from('test_series')
      .select(
        'id, title, description, category_id, subcategory_id, difficulty_id, logo_url, slug, is_published, display_order, created_at, updated_at',
        { count: 'exact' }
      )
      .is('deleted_at', null)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNumber - 1);

    if (search) {
      const searchTerm = search.trim();
      query = query.or(`title.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
    }

    if (category) {
      const categoryData = metadata.categoriesMap[category];
      if (categoryData) query = query.eq('category_id', categoryData.id);
    }

    if (subcategory) {
      const subcategoryData = metadata.subcategoriesMap[subcategory];
      if (subcategoryData) query = query.eq('subcategory_id', subcategoryData.id);
    }

    if (difficulty) {
      const difficultyData = metadata.difficultiesMap[difficulty];
      if (difficultyData) query = query.eq('difficulty_id', difficultyData.id);
    }

    if (is_published !== undefined && is_published !== '') {
      query = query.eq('is_published', is_published === 'true');
    }

    const { data: testSeries, error, count } = await query;

    if (error) {
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

    const { data: testSeries, error } = await supabase
      .from('test_series')
      .select(`
        *,
        category:exam_categories(id, name, slug, logo_url),
        subcategory:exam_subcategories(id, name, slug),
        difficulty:exam_difficulties(id, name, slug)
      `)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error || !testSeries) {
      logger.error('Error fetching test series:', error);
      return res.status(404).json({ error: 'Test series not found' });
    }

    const { data: sections } = await supabase
      .from('test_series_sections')
      .select('*')
      .eq('test_series_id', id)
      .order('display_order', { ascending: true });

    testSeries.sections = sections || [];

    for (const section of testSeries.sections) {
      const { data: topics } = await supabase
        .from('test_series_topics')
        .select('*')
        .eq('section_id', section.id)
        .order('display_order', { ascending: true });
      section.topics = topics || [];
    }

    const { data: exams } = await supabase
      .from('exams')
      .select(`
        id, title, duration, total_marks, total_questions, status, exam_date,
        is_free, logo_url, thumbnail_url, test_series_section_id, test_series_topic_id,
        display_order, slug, url_path, category, category_id, subcategory, subcategory_id,
        difficulty, difficulty_id, is_published, allow_anytime, start_date, end_date,
        supports_hindi, is_premium, pass_percentage, negative_marking, negative_mark_value,
        created_at, updated_at, exam_type, show_in_mock_tests
      `)
      .eq('test_series_id', id)
      .is('deleted_at', null)
      .order('display_order', { ascending: true })
      .order('exam_date', { ascending: true });

    testSeries.exams = exams || [];

    const fallbackCategorySource = (exams || []).find(e => e.category_id || e.category) || null;
    const fallbackCategory = fallbackCategorySource
      ? { id: fallbackCategorySource.category_id, slug: fallbackCategorySource.category }
      : null;
    await hydrateSeriesCategory(testSeries, fallbackCategory);

    const examIds = (exams || []).map(e => e.id);
    let attemptCount = 0;
    if (examIds.length > 0) {
      const { count } = await supabase
        .from('exam_attempts')
        .select('id', { count: 'exact', head: true })
        .in('exam_id', examIds);
      attemptCount = count || 0;
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

    const { data: testSeries, error } = await supabase
      .from('test_series')
      .select(`
        *,
        category:exam_categories(id, name, slug, logo_url),
        subcategory:exam_subcategories(id, name, slug),
        difficulty:exam_difficulties(id, name, slug)
      `)
      .eq('slug', slug)
      .eq('is_published', true)
      .is('deleted_at', null)
      .single();

    if (error || !testSeries) {
      logger.error('Error fetching test series by slug:', error);
      return res.status(404).json({ error: 'Test series not found' });
    }

    await hydrateSeriesCategory(testSeries);

    const { data: sections } = await supabase
      .from('test_series_sections')
      .select('*')
      .eq('test_series_id', testSeries.id)
      .order('display_order', { ascending: true });

    testSeries.sections = sections || [];

    for (const section of testSeries.sections) {
      const { data: topics } = await supabase
        .from('test_series_topics')
        .select('*')
        .eq('section_id', section.id)
        .order('display_order', { ascending: true });
      section.topics = topics || [];
    }

    const { data: exams } = await supabase
      .from('exams')
      .select(`
        id, title, duration, total_marks, total_questions, status, exam_date,
        is_free, logo_url, thumbnail_url, test_series_section_id, test_series_topic_id,
        display_order, slug, url_path, category, category_id, subcategory, subcategory_id,
        difficulty, difficulty_id, is_published, allow_anytime, start_date, end_date,
        supports_hindi, is_premium, pass_percentage, negative_marking, negative_mark_value,
        created_at, updated_at, exam_type, show_in_mock_tests,
        exam_categories(logo_url, icon)
      `)
      .eq('test_series_id', testSeries.id)
      .is('deleted_at', null)
      .order('display_order', { ascending: true })
      .order('exam_date', { ascending: true });

    const safeExams = exams || [];
    testSeries.exams = safeExams;

    const fallbackCategorySource = safeExams.find(e => e.category_id || e.category) || null;
    const fallbackCategory = fallbackCategorySource
      ? { id: fallbackCategorySource.category_id, slug: fallbackCategorySource.category }
      : null;
    await hydrateSeriesCategory(testSeries, fallbackCategory);

    let attemptCount = 0;
    if (safeExams.length > 0) {
      const { count } = await supabase
        .from('exam_attempts')
        .select('id', { count: 'exact', head: true })
        .in('exam_id', safeExams.map(e => e.id));
      attemptCount = count || 0;
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
      title, description, category_id, subcategory_id, difficulty_id,
      is_published, is_free, price, display_order, logo_url, thumbnail_url,
    } = req.body;

    if (!title) return res.status(400).json({ error: 'Title is required' });

    const baseSlug = slugify(title);
    const slug = await ensureUniqueSlug(supabase, 'test_series', baseSlug);

    const { data: testSeries, error } = await supabase
      .from('test_series')
      .insert({
        title, description, slug, category_id, subcategory_id, difficulty_id,
        is_published: is_published || false,
        is_free: is_free !== undefined ? is_free : true,
        price: price || 0,
        display_order: display_order || 0,
        logo_url, thumbnail_url,
      })
      .select()
      .single();

    if (error) {
      logger.error('Error creating test series:', error);
      return res.status(500).json({ error: 'Failed to create test series' });
    }

    res.status(201).json(testSeries);
  } catch (error) {
    logger.error('Error in createTestSeries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateTestSeries = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title, description, category_id, subcategory_id, difficulty_id,
      is_published, is_free, price, display_order, logo_url, thumbnail_url,
    } = req.body;

    const updateData = { updated_at: new Date().toISOString() };

    if (title !== undefined) {
      updateData.title = title;
      const baseSlug = slugify(title);
      updateData.slug = await ensureUniqueSlug(supabase, 'test_series', baseSlug, { excludeId: id });
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

    const { data: testSeries, error } = await supabase
      .from('test_series')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Error updating test series:', error);
      return res.status(500).json({ error: 'Failed to update test series' });
    }

    res.json(testSeries);
  } catch (error) {
    logger.error('Error in updateTestSeries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteTestSeries = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('test_series')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      logger.error('Error deleting test series:', error);
      return res.status(500).json({ error: 'Failed to delete test series' });
    }

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

    const { data: section, error } = await supabase
      .from('test_series_sections')
      .insert({ test_series_id, name, description, display_order: display_order || 0 })
      .select()
      .single();

    if (error) {
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
    const updateData = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (display_order !== undefined) updateData.display_order = display_order;

    const { data: section, error } = await supabase
      .from('test_series_sections')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
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
    const { error } = await supabase.from('test_series_sections').delete().eq('id', id);
    if (error) {
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

    const { data: topic, error } = await supabase
      .from('test_series_topics')
      .insert({ section_id, name, description, display_order: display_order || 0 })
      .select()
      .single();

    if (error) {
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
    const updateData = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (display_order !== undefined) updateData.display_order = display_order;

    const { data: topic, error } = await supabase
      .from('test_series_topics')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
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
    const { error } = await supabase.from('test_series_topics').delete().eq('id', id);
    if (error) {
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
    const { data: sections, error } = await supabase
      .from('test_series_sections')
      .select('*')
      .eq('test_series_id', test_series_id)
      .order('display_order', { ascending: true });

    if (error) {
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
    const { data: topics, error } = await supabase
      .from('test_series_topics')
      .select('*')
      .eq('section_id', section_id)
      .order('display_order', { ascending: true });

    if (error) {
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

    const updates = validIds.map((id, index) =>
      supabase.from('test_series_sections').update({ display_order: index }).eq('id', id)
    );
    const results = await Promise.all(updates);
    const failed = results.find(r => r.error);
    if (failed) {
      logger.error('Reorder sections error:', failed.error);
      return res.status(500).json({ success: false, message: 'Failed to reorder sections' });
    }
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

    const updates = orderedIds.map((id, index) =>
      supabase.from('test_series_topics').update({ display_order: index }).eq('id', id)
    );
    const results = await Promise.all(updates);
    const failed = results.find(r => r.error);
    if (failed) {
      logger.error('Reorder topics error:', failed.error);
      return res.status(500).json({ success: false, message: 'Failed to reorder topics' });
    }
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

    const updates = orderedIds.map((id, index) =>
      supabase.from('exams').update({ display_order: index }).eq('id', id)
    );
    const results = await Promise.all(updates);
    const failed = results.find(r => r.error);
    if (failed) {
      logger.error('Reorder exams error:', failed.error);
      return res.status(500).json({ success: false, message: 'Failed to reorder exams' });
    }
    res.json({ success: true, message: 'Exams reordered successfully' });
  } catch (error) {
    logger.error('Reorder exams error:', error);
    res.status(500).json({ success: false, message: 'Server error while reordering exams' });
  }
};

const uploadTestSeriesLogo = async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const { data: testSeries, error: fetchError } = await supabase
      .from('test_series').select('id, logo_url').eq('id', id).single();

    if (fetchError || !testSeries) return res.status(404).json({ error: 'Test series not found' });

    if (testSeries.logo_url) {
      const oldKey = extractKeyFromUrl(testSeries.logo_url);
      if (oldKey) {
        try { await deleteFile(oldKey); } catch (e) { logger.warn('Failed to delete old logo:', e); }
      }
    }

    const uploadResult = await uploadFile(file, 'test-series/logos');

    const { data: updatedSeries, error: updateError } = await supabase
      .from('test_series')
      .update({ logo_url: uploadResult.url, updated_at: new Date().toISOString() })
      .eq('id', id).select().single();

    if (updateError) {
      logger.error('Error updating test series logo:', updateError);
      return res.status(500).json({ error: 'Failed to update test series logo' });
    }
    res.json({ success: true, logo_url: uploadResult.url, test_series: updatedSeries });
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

    const { data: testSeries, error: fetchError } = await supabase
      .from('test_series').select('id, thumbnail_url').eq('id', id).single();

    if (fetchError || !testSeries) return res.status(404).json({ error: 'Test series not found' });

    if (testSeries.thumbnail_url) {
      const oldKey = extractKeyFromUrl(testSeries.thumbnail_url);
      if (oldKey) {
        try { await deleteFile(oldKey); } catch (e) { logger.warn('Failed to delete old thumbnail:', e); }
      }
    }

    const uploadResult = await uploadFile(file, 'test-series/thumbnails');

    const { data: updatedSeries, error: updateError } = await supabase
      .from('test_series')
      .update({ thumbnail_url: uploadResult.url, updated_at: new Date().toISOString() })
      .eq('id', id).select().single();

    if (updateError) {
      logger.error('Error updating test series thumbnail:', updateError);
      return res.status(500).json({ error: 'Failed to update test series thumbnail' });
    }
    res.json({ success: true, thumbnail_url: uploadResult.url, test_series: updatedSeries });
  } catch (error) {
    logger.error('Error uploading test series thumbnail:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteTestSeriesLogo = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: testSeries, error: fetchError } = await supabase
      .from('test_series').select('id, logo_url').eq('id', id).single();

    if (fetchError || !testSeries) return res.status(404).json({ error: 'Test series not found' });
    if (!testSeries.logo_url) return res.status(400).json({ error: 'No logo to delete' });

    const fileKey = extractKeyFromUrl(testSeries.logo_url);
    if (fileKey) {
      try { await deleteFile(fileKey); } catch (e) { logger.warn('Failed to delete logo file:', e); }
    }

    const { data: updatedSeries, error: updateError } = await supabase
      .from('test_series')
      .update({ logo_url: null, updated_at: new Date().toISOString() })
      .eq('id', id).select().single();

    if (updateError) {
      logger.error('Error removing test series logo:', updateError);
      return res.status(500).json({ error: 'Failed to remove test series logo' });
    }
    res.json({ success: true, message: 'Logo deleted successfully', test_series: updatedSeries });
  } catch (error) {
    logger.error('Error deleting test series logo:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteTestSeriesThumbnail = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: testSeries, error: fetchError } = await supabase
      .from('test_series').select('id, thumbnail_url').eq('id', id).single();

    if (fetchError || !testSeries) return res.status(404).json({ error: 'Test series not found' });
    if (!testSeries.thumbnail_url) return res.status(400).json({ error: 'No thumbnail to delete' });

    const fileKey = extractKeyFromUrl(testSeries.thumbnail_url);
    if (fileKey) {
      try { await deleteFile(fileKey); } catch (e) { logger.warn('Failed to delete thumbnail file:', e); }
    }

    const { data: updatedSeries, error: updateError } = await supabase
      .from('test_series')
      .update({ thumbnail_url: null, updated_at: new Date().toISOString() })
      .eq('id', id).select().single();

    if (updateError) {
      logger.error('Error removing test series thumbnail:', updateError);
      return res.status(500).json({ error: 'Failed to remove test series thumbnail' });
    }
    res.json({ success: true, message: 'Thumbnail deleted successfully', test_series: updatedSeries });
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
  uploadTestSeriesLogo,
  uploadTestSeriesThumbnail,
  deleteTestSeriesLogo,
  deleteTestSeriesThumbnail,
};
