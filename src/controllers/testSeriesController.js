const supabase = require('../config/database');
const logger = require('../config/logger');
const { slugify, ensureUniqueSlug } = require('../utils/slugify');

const isValidUuid = (value = '') => {
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
  return uuidRegex.test(value);
};

const fetchCategoryDetails = async ({ id, slug }) => {
  if (!id && !slug) return null;

  const normalizedSlug = slug ? slugify(slug) : null;

  let query = supabase
    .from('exam_categories')
    .select('id, name, slug, logo_url')
    .limit(1);

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

  const categoryDetails = await fetchCategoryDetails({
    id: preferredCategoryId,
    slug: preferredCategorySlug
  });

  if (categoryDetails) {
    series.category = categoryDetails;
    series.category_id = categoryDetails.id;
  }
};

const getAllTestSeries = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      category,
      subcategory,
      difficulty,
      is_published
    } = req.query;

    const pageNumber = parseInt(page, 10) || 1;
    const limitNumber = parseInt(limit, 10) || 10;
    const offset = (pageNumber - 1) * limitNumber;

    let resolvedCategoryId = null;
    let resolvedCategorySlug = null;
    let categorySeriesIds = null;

    if (category) {
      if (isValidUuid(category)) {
        resolvedCategoryId = category;
        const categoryDetails = await fetchCategoryDetails({ id: category });
        if (categoryDetails?.slug) {
          resolvedCategorySlug = slugify(categoryDetails.slug);
        }
      } else {
        const normalizedSlug = slugify(category);
        resolvedCategorySlug = normalizedSlug;
        const categoryDetails = await fetchCategoryDetails({ slug: normalizedSlug });
        if (categoryDetails?.id) {
          resolvedCategoryId = categoryDetails.id;
          resolvedCategorySlug = slugify(categoryDetails.slug);
        }
      }

      categorySeriesIds = new Set();

      if (resolvedCategoryId) {
        const { data: directSeries, error: directCategoryError } = await supabase
          .from('test_series')
          .select('id')
          .eq('category_id', resolvedCategoryId)
          .is('deleted_at', null);

        if (directCategoryError) {
          logger.error('Error fetching direct category matches for test series:', directCategoryError);
        } else if (directSeries) {
          directSeries.forEach(series => {
            if (series?.id) {
              categorySeriesIds.add(series.id);
            }
          });
        }
      }

      const examConditions = [];
      if (resolvedCategoryId) {
        examConditions.push(`category_id.eq.${resolvedCategoryId}`);
      }
      if (resolvedCategorySlug) {
        examConditions.push(`category.eq.${resolvedCategorySlug}`);
      }

      if (examConditions.length > 0) {
        const { data: examSeries, error: categoryExamError } = await supabase
          .from('exams')
          .select('test_series_id')
          .is('deleted_at', null)
          .not('test_series_id', 'is', null)
          .or(examConditions.join(','));

        if (categoryExamError) {
          logger.error('Error fetching exam category mappings for test series:', categoryExamError);
        } else if (examSeries) {
          examSeries.forEach(exam => {
            if (exam?.test_series_id) {
              categorySeriesIds.add(exam.test_series_id);
            }
          });
        }
      }

      if (categorySeriesIds.size === 0) {
        return res.json({
          data: [],
          total: 0,
          page: pageNumber,
          limit: limitNumber,
          totalPages: 0
        });
      }
    }

    let query = supabase
      .from('test_series')
      .select(`
        *,
        category:exam_categories(id, name, slug, logo_url),
        subcategory:exam_subcategories(id, name, slug),
        difficulty:exam_difficulties(id, name, slug)
      `, { count: 'exact' })
      .is('deleted_at', null)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNumber - 1);

    if (categorySeriesIds && categorySeriesIds.size > 0) {
      query = query.in('id', Array.from(categorySeriesIds));
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    if (subcategory) {
      query = query.eq('subcategory_id', subcategory);
    }

    if (difficulty) {
      query = query.eq('difficulty_id', difficulty);
    }

    if (is_published !== undefined) {
      query = query.eq('is_published', is_published === 'true');
    }

    const { data: testSeries, error, count } = await query;

    if (error) {
      logger.error('Error fetching test series:', error);
      return res.status(500).json({ error: 'Failed to fetch test series' });
    }

    const seriesIds = testSeries.map(series => series.id);
    const statsMap = new Map();

    const fallbackCategoryMap = new Map();

    if (seriesIds.length > 0) {
      const { data: examStats, error: examStatsError } = await supabase
        .from('exams')
        .select('id, test_series_id, is_free, supports_hindi, category, category_id')
        .in('test_series_id', seriesIds)
        .is('deleted_at', null);

      if (examStatsError) {
        logger.error('Error fetching exam stats for test series:', examStatsError);
      } else if (examStats) {
        examStats.forEach(exam => {
          const existing = statsMap.get(exam.test_series_id) || {
            total: 0,
            free: 0,
            supportsHindi: false
          };
          existing.total += 1;
          if (exam.is_free) {
            existing.free += 1;
          }
          existing.supportsHindi = existing.supportsHindi || Boolean(exam.supports_hindi);
          statsMap.set(exam.test_series_id, existing);

          const hasFallback = fallbackCategoryMap.has(exam.test_series_id);
          if (!hasFallback && (exam.category_id || exam.category)) {
            fallbackCategoryMap.set(exam.test_series_id, {
              id: exam.category_id || null,
              slug: exam.category || null
            });
          }
        });
      }
    }

    for (const series of testSeries) {
      const stats = statsMap.get(series.id) || { total: 0, free: 0, supportsHindi: false };
      const languages = ['English'];
      if (stats.supportsHindi) {
        languages.push('Hindi');
      }

      series.total_tests = stats.total;
      series.free_tests = stats.free;
      series.languages = languages;
      series.languages_text = languages.join(', ');

      const fallbackCategory = fallbackCategoryMap.get(series.id) || null;
      await hydrateSeriesCategory(series, fallbackCategory);
    }

    res.json({
      data: testSeries,
      total: count,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(count / limitNumber)
    });
  } catch (error) {
    logger.error('Error in getAllTestSeries:', error);
    res.status(500).json({ error: 'Internal server error' });
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
        id,
        title,
        duration,
        total_marks,
        total_questions,
        status,
        exam_date,
        is_free,
        logo_url,
        thumbnail_url,
        test_series_section_id,
        test_series_topic_id,
        display_order,
        slug,
        url_path,
        category,
        category_id,
        subcategory,
        subcategory_id,
        difficulty,
        difficulty_id,
        is_published,
        allow_anytime,
        start_date,
        end_date,
        supports_hindi,
        is_premium,
        pass_percentage,
        negative_marking,
        negative_mark_value,
        created_at,
        updated_at,
        exam_type,
        show_in_mock_tests
      `)
      .eq('test_series_id', id)
      .is('deleted_at', null)
      .order('display_order', { ascending: true })
      .order('exam_date', { ascending: true });

    testSeries.exams = exams || [];

    const fallbackCategorySource = exams.find(exam => exam.category_id || exam.category) || null;
    const fallbackCategory = fallbackCategorySource
      ? { id: fallbackCategorySource.category_id, slug: fallbackCategorySource.category }
      : null;
    await hydrateSeriesCategory(testSeries, fallbackCategory);

    const { count: attemptCount } = await supabase
      .from('exam_attempts')
      .select('id', { count: 'exact', head: true })
      .in('exam_id', exams.map(e => e.id));

    testSeries.total_attempts = attemptCount || 0;

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
        id,
        title,
        duration,
        total_marks,
        total_questions,
        status,
        exam_date,
        is_free,
        logo_url,
        thumbnail_url,
        test_series_section_id,
        test_series_topic_id,
        display_order,
        slug,
        url_path,
        category,
        category_id,
        subcategory,
        subcategory_id,
        difficulty,
        difficulty_id,
        is_published,
        allow_anytime,
        start_date,
        end_date,
        supports_hindi,
        is_premium,
        pass_percentage,
        negative_marking,
        negative_mark_value,
        created_at,
        updated_at,
        exam_type,
        show_in_mock_tests
      `)
      .eq('test_series_id', testSeries.id)
      .is('deleted_at', null)
      .order('display_order', { ascending: true })
      .order('exam_date', { ascending: true });

    const safeExams = exams || [];
    testSeries.exams = safeExams;

    const fallbackCategorySource = safeExams.find(exam => exam.category_id || exam.category) || null;
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
      title,
      description,
      category_id,
      subcategory_id,
      difficulty_id,
      is_published,
      is_free,
      price,
      display_order,
      logo_url,
      thumbnail_url
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const baseSlug = slugify(title);
    const slug = await ensureUniqueSlug(supabase, 'test_series', baseSlug);

    const { data: testSeries, error } = await supabase
      .from('test_series')
      .insert({
        title,
        description,
        slug,
        category_id,
        subcategory_id,
        difficulty_id,
        is_published: is_published || false,
        is_free: is_free !== undefined ? is_free : true,
        price: price || 0,
        display_order: display_order || 0,
        logo_url,
        thumbnail_url
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
      title,
      description,
      category_id,
      subcategory_id,
      difficulty_id,
      is_published,
      is_free,
      price,
      display_order,
      logo_url,
      thumbnail_url
    } = req.body;

    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (title !== undefined) {
      updateData.title = title;
      const baseSlug = slugify(title);
      updateData.slug = await ensureUniqueSlug(supabase, 'test_series', baseSlug, {
        excludeId: id
      });
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

    if (!test_series_id || !name) {
      return res.status(400).json({ error: 'Test series ID and name are required' });
    }

    const { data: section, error } = await supabase
      .from('test_series_sections')
      .insert({
        test_series_id,
        name,
        description,
        display_order: display_order || 0
      })
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

    const { error } = await supabase
      .from('test_series_sections')
      .delete()
      .eq('id', id);

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

    if (!section_id || !name) {
      return res.status(400).json({ error: 'Section ID and name are required' });
    }

    const { data: topic, error } = await supabase
      .from('test_series_topics')
      .insert({
        section_id,
        name,
        description,
        display_order: display_order || 0
      })
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

    const { error } = await supabase
      .from('test_series_topics')
      .delete()
      .eq('id', id);

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
  getTopicsBySection
};
