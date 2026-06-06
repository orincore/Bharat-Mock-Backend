const supabase = require('../config/database');
const logger = require('../config/logger');
const { redisCache, CACHE_TTL, buildCacheKey } = require('../utils/redisCache');

const EXAM_CACHE_VERSION = 'v6';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const batchLoadCategoriesAndSubcategories = async () => {
  const cacheKey = buildCacheKey('metadata', 'categories_subcategories_difficulties');
  const cached = await redisCache.get(cacheKey);
  if (cached) return cached;

  const [categoriesResult, subcategoriesResult, difficultiesResult] = await Promise.all([
    supabase.from('exam_categories').select('id, name, slug, logo_url, icon'),
    supabase.from('exam_subcategories').select('id, name, slug, category_id'),
    supabase.from('exam_difficulties').select('id, name, slug, level_order'),
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
    metadata.difficultiesMap[diff.name] = diff;
  });

  await redisCache.set(cacheKey, metadata, CACHE_TTL.CATEGORIES);
  return metadata;
};

// Apply the exam-listing WHERE filters to a Supabase query.
// Shared by the main listing query and the year-facet query so the two never drift.
// `includeYear: false` omits the year filter — used when building the year dropdown
// so it reflects the OTHER active filters but still lists every selectable year.
const applyExamFilters = (query, filters, metadata, { includeYear = true } = {}) => {
  const {
    search, category, subcategory, status, difficulty,
    exam_type, is_premium, year, paper_section_id, paper_topic_id,
  } = filters;

  if (search) {
    const searchTerm = String(search).trim().replace(/\s+/g, ' ');
    const hasSpecialChars = /[(),]/.test(searchTerm);
    const titlePattern = `%${searchTerm.replace(/ /g, '%')}%`;
    if (hasSpecialChars) {
      query = query.ilike('title', titlePattern);
    } else {
      const plainPattern = `%${searchTerm}%`;
      query = query.or(`title.ilike.${titlePattern},slug.ilike.${plainPattern},url_path.ilike.${plainPattern}`);
    }
  }

  if (category) {
    const categoryData = metadata.categoriesMap[category];
    if (categoryData) query = query.eq('category_id', categoryData.id);
  }

  if (subcategory) {
    const subcategoryData = metadata.subcategoriesMap[subcategory];
    if (subcategoryData) query = query.eq('subcategory_id', subcategoryData.id);
  }

  if (status) query = query.eq('status', status);

  if (difficulty) {
    const difficultyData = metadata.difficultiesMap[difficulty];
    if (difficultyData?.id) {
      query = query.or(`difficulty_id.eq.${difficultyData.id},difficulty.eq.${difficultyData.slug},difficulty.eq.${difficultyData.name}`);
    } else {
      query = query.eq('difficulty', difficulty);
    }
  }

  if (exam_type) {
    if (exam_type === 'mock_test') {
      query = query.or('exam_type.eq.mock_test,and(exam_type.eq.past_paper,show_in_mock_tests.eq.true)');
    } else if (exam_type !== 'all') {
      query = query.eq('exam_type', exam_type);
    }
  }

  if (is_premium === 'true') query = query.eq('is_premium', true);
  else if (is_premium === 'false') query = query.eq('is_premium', false);

  if (includeYear && year) {
    const yearList = String(year).split(',').map(v => parseInt(v.trim(), 10)).filter(v => !Number.isNaN(v));
    if (yearList.length === 1) {
      query = query.gte('exam_date', `${yearList[0]}-01-01`).lt('exam_date', `${yearList[0] + 1}-01-01`);
    } else if (yearList.length > 1) {
      const orFilters = yearList.map(yr => `and(exam_date.gte.${yr}-01-01,exam_date.lt.${yr + 1}-01-01)`);
      query = query.or(orFilters.join(','));
    }
  }

  if (paper_topic_id) query = query.eq('paper_topic_id', paper_topic_id);
  if (paper_section_id) query = query.eq('paper_section_id', paper_section_id);

  return query;
};

// Build the year-filter facet for the CURRENT filter context.
// Only returns years that have at least one matching published exam, so a year with
// 0 available exams (globally or within the active category/section/etc.) is hidden.
const getFilteredExamYears = async (filters, metadata) => {
  let query = supabase
    .from('exams')
    .select('exam_date')
    .eq('is_published', true)
    .is('deleted_at', null)
    .not('exam_date', 'is', null);

  query = applyExamFilters(query, filters, metadata, { includeYear: false });

  const { data, error } = await query;
  if (error) {
    logger.error('Error fetching filtered exam years:', error);
    return [];
  }

  return [...new Set(
    data
      .map(exam => (exam.exam_date ? new Date(exam.exam_date).getFullYear() : null))
      .filter(Boolean)
  )].sort((a, b) => b - a);
};

const buildExamCacheKey = (params) => {
  const {
    page = 1, limit = 10, search = '', category = '', subcategory = '',
    status = '', difficulty = '', exam_type = '', is_premium = '',
    year = '', paper_section_id = '', paper_topic_id = '',
    sortBy = '', sortOrder = '',
  } = params;
  return buildCacheKey(
    'exams', EXAM_CACHE_VERSION, page, limit,
    search.toLowerCase().trim(), category, subcategory, status,
    difficulty, exam_type, is_premium, year, paper_section_id, paper_topic_id,
    sortBy, sortOrder
  );
};

const buildExamDetailCacheKey = (identifier) => `exam-detail:${identifier}`;

const hasPremiumExamAccess = async (userId) => {
  const nowIso = new Date().toISOString();

  // Primary check: live subscription table is the authoritative source
  // Checks active/canceled subscriptions that haven't expired yet
  const { data: subscription, error: subscriptionError } = await supabase
    .from('user_subscriptions')
    .select('id, status, expires_at')
    .eq('user_id', userId)
    .in('status', ['active', 'canceled'])
    .not('expires_at', 'is', null)
    .gte('expires_at', nowIso)
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!subscriptionError && subscription) return true;

  if (subscriptionError) {
    logger.warn('Failed to fetch user subscription for exam access:', subscriptionError, { userId });
  }

  // Fallback: trust users.is_premium + subscription_expires_at cache
  // (in case user_subscriptions query fails)
  const { data: user } = await supabase
    .from('users')
    .select('is_premium, subscription_expires_at')
    .eq('id', userId)
    .maybeSingle();

  if (!user?.is_premium) return false;
  if (!user.subscription_expires_at) return true;
  return new Date(user.subscription_expires_at).toISOString() >= nowIso;
};

const buildExamQuery = () => supabase
  .from('exams')
  .select(`
    id, title, duration, total_marks, total_questions, category, difficulty,
    status, start_date, end_date, exam_date, pass_percentage, is_free,
    image_url, logo_url, thumbnail_url, pdf_url_en, pdf_url_hi,
    negative_marking, negative_mark_value, allow_anytime, supports_hindi,
    exam_type, is_premium, slug, url_path, exam_uid,
    exam_categories(logo_url, icon), attempts
  `)
  .eq('is_published', true)
  .is('deleted_at', null);

const fetchExamByIdentifier = async (identifier) => {
  const cacheKey = buildExamDetailCacheKey(`fetch:${identifier}`);
  const cached = await redisCache.get(cacheKey);
  if (cached) return { exam: cached, error: null };

  const normalizedId = identifier?.trim() || '';
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizedId);
  const isUrlPath = normalizedId.includes('/') && normalizedId.length > 0;
  const slugFallback = normalizedId.split('/').filter(Boolean).pop();

  const runQuery = async (filter) => {
    const { data, error } = await buildExamQuery().match(filter).single();
    return { exam: data, error };
  };

  logger.info('fetchExamByIdentifier called', { identifier: normalizedId, isUUID, isUrlPath, slugFallback });

  if (isUUID) {
    const result = await runQuery({ id: normalizedId });
    if (result.exam) await redisCache.set(cacheKey, result.exam, CACHE_TTL.EXAM_DETAILS);
    return result;
  }

  const isExamUid = /^BHMK[A-Z0-9]+$/i.test(normalizedId);
  if (isExamUid) {
    const result = await runQuery({ exam_uid: normalizedId });
    if (result.exam) {
      await redisCache.set(cacheKey, result.exam, CACHE_TTL.EXAM_DETAILS);
      return result;
    }
  }

  if (isUrlPath) {
    const path = normalizedId.startsWith('/') ? normalizedId : `/${normalizedId}`;
    logger.info('Attempting path lookup', { path });
    const { data: exam, error } = await buildExamQuery().eq('url_path', path).single();
    logger.info('Path lookup result', { found: !!exam, error: error?.message });

    if (!error && exam) {
      await redisCache.set(cacheKey, exam, CACHE_TTL.EXAM_DETAILS);
      return { exam, error: null };
    }

    logger.info('Attempting slug fallback lookup', { slug: slugFallback });
    const { exam: slugExam, error: slugError } = await runQuery({ slug: slugFallback });
    logger.info('Slug lookup result', { found: !!slugExam, error: slugError?.message });
    if (slugExam) await redisCache.set(cacheKey, slugExam, CACHE_TTL.EXAM_DETAILS);
    return { exam: slugExam, error: slugError };
  }

  return runQuery({ slug: normalizedId });
};

const enrichExamDetails = async (exam, user) => {
  const [syllabusRes, sectionsRes] = await Promise.all([
    supabase.from('exam_syllabus').select('topic').eq('exam_id', exam.id),
    supabase.from('exam_sections')
      .select('id, name, total_questions, marks_per_question, duration, section_order')
      .eq('exam_id', exam.id)
      .order('section_order'),
  ]);

  exam.syllabus = syllabusRes.data?.map(s => s.topic) || [];
  exam.pattern = {
    sections: sectionsRes.data || [],
    negativeMarking: exam.negative_marking,
    negativeMarkValue: exam.negative_mark_value,
  };

  if (user) {
    const { count: attempts } = await supabase
      .from('exam_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('exam_id', exam.id)
      .eq('user_id', user.id);
    exam.attempts = attempts || 0;
  }

  return exam;
};

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

const getExams = async (req, res) => {
  try {
    const {
      page = 1, limit = 10, search, category, subcategory,
      status, difficulty, exam_type, is_premium, year,
      paper_section_id, paper_topic_id, sortBy = 'created_at', sortOrder = 'desc'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    const cacheKey = buildExamCacheKey(req.query || {});
    const cachedResponse = await redisCache.get(cacheKey);
    if (cachedResponse && !sortBy) return res.json(cachedResponse);
    // If sortBy is present, we bypass/refresh cache to ensure accurate rankings

    const metadata = await batchLoadCategoriesAndSubcategories();

    let query = supabase
      .from('exams')
      .select(
        'id, title, duration, total_marks, total_questions, category_id, subcategory_id, difficulty, difficulty_id, status, start_date, end_date, exam_date, is_free, image_url, logo_url, thumbnail_url, allow_anytime, supports_hindi, exam_type, is_premium, slug, url_path, created_at, attempts',
        { count: 'exact' }
      )
      .eq('is_published', true)
      .is('deleted_at', null);

    // Apply sorting
    if (sortBy === 'attempts') {
      query = query.order('attempts', { ascending: sortOrder === 'asc' });
    } else {
      query = query.order(sortBy, { ascending: sortOrder === 'asc' });
    }

    // Apply all listing filters (search, category, subcategory, status, difficulty,
    // exam_type, is_premium, year, paper section/topic) via the shared helper.
    query = applyExamFilters(query, req.query, metadata, { includeYear: true });

    // Apply range at the end after all filters
    query = query.range(offset, offset + limitNum - 1);

    const { data: exams, error, count } = await query;

    if (error) {
      logger.error('Error fetching exams:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch exams', error: error.message });
    }

    const enrichedExams = exams.map(exam => ({
      ...exam,
      exam_categories: exam.category_id ? metadata.categoriesMap[exam.category_id] : null,
      exam_subcategories: exam.subcategory_id ? metadata.subcategoriesMap[exam.subcategory_id] : null,
    }));

    // Year facet scoped to the current filters — years with 0 matching exams are excluded.
    const years = await getFilteredExamYears(req.query, metadata);

    const response = {
      success: true,
      data: enrichedExams,
      years,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
    };

    await redisCache.set(cacheKey, response, CACHE_TTL.EXAMS);
    res.json(response);
  } catch (error) {
    logger.error('Error in getExams:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

const getExamHistory = async (req, res) => {
  try {
    const { page = 1, status = '' } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = 20;
    const offset = (pageNum - 1) * limitNum;

    let attemptsQuery = supabase
      .from('exam_attempts')
      .select(`
        id,
        exam_id,
        language,
        started_at,
        updated_at,
        is_submitted,
        time_taken,
        exams!inner (
          id,
          title,
          category,
          total_questions,
          duration,
          deleted_at
        )
      `, { count: 'exact' })
      .eq('user_id', req.user.id)
      .is('exams.deleted_at', null)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (status === 'in-progress') {
      attemptsQuery = attemptsQuery.eq('is_submitted', false);
    } else if (status === 'completed') {
      attemptsQuery = attemptsQuery.eq('is_submitted', true);
    }

    const { data: attempts, error, count } = await attemptsQuery;

    if (error) {
      logger.error('Error fetching exam history:', error, { userId: req.user.id });
      return res.status(500).json({ success: false, message: 'Failed to fetch exam history' });
    }

    const attemptIds = (attempts || []).map(attempt => attempt.id);
    const [answersRes, resultsRes] = await Promise.all([
      attemptIds.length
        ? supabase
            .from('user_answers')
            .select('attempt_id, question_id, answer')
            .in('attempt_id', attemptIds)
        : Promise.resolve({ data: [] }),
      attemptIds.length
        ? supabase
            .from('results')
            .select('attempt_id, score, total_marks, percentage')
            .in('attempt_id', attemptIds)
        : Promise.resolve({ data: [] }),
    ]);

    const answerCountByAttempt = new Map();
    (answersRes.data || []).forEach(answer => {
      const hasAnswer = Array.isArray(answer.answer)
        ? answer.answer.length > 0
        : typeof answer.answer === 'string'
          ? answer.answer.trim().length > 0
          : Boolean(answer.answer);

      if (!hasAnswer) return;
      answerCountByAttempt.set(
        answer.attempt_id,
        (answerCountByAttempt.get(answer.attempt_id) || 0) + 1
      );
    });

    const resultByAttempt = new Map((resultsRes.data || []).map(result => [result.attempt_id, result]));

    const entries = (attempts || []).map(attempt => {
      const answeredQuestions = answerCountByAttempt.get(attempt.id) || 0;
      const totalQuestions = attempt.exams?.total_questions || 0;
      const result = resultByAttempt.get(attempt.id);
      return {
        attemptId: attempt.id,
        examId: attempt.exam_id,
        examTitle: attempt.exams?.title || 'Exam',
        category: attempt.exams?.category || '',
        status: attempt.is_submitted ? 'completed' : 'in-progress',
        startedAt: attempt.started_at,
        updatedAt: attempt.updated_at,
        language: attempt.language || 'en',
        answeredQuestions,
        totalQuestions,
        duration: attempt.exams?.duration || 0,
        timeSpent: attempt.time_taken || 0,
        resumeAllowed: !attempt.is_submitted,
        score: result?.score,
        totalMarks: result?.total_marks,
        percentage: result?.percentage,
      };
    });

    const metrics = {
      totalAttempts: count || 0,
      completed: entries.filter(entry => entry.status === 'completed').length,
      inProgress: entries.filter(entry => entry.status === 'in-progress').length,
    };

    return res.json({
      success: true,
      data: entries,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
      metrics,
    });
  } catch (error) {
    logger.error('Error in getExamHistory:', error, { userId: req.user?.id });
    return res.status(500).json({ success: false, message: 'Failed to fetch exam history' });
  }
};

const getExamByShortPath = async (req, res) => {
  try {
    const { parentSlug, examSlug } = req.params;
    const path = `/${parentSlug}/${examSlug}`;
    const cacheKey = buildExamDetailCacheKey(path);
    const cachedExam = await redisCache.get(cacheKey);
    if (cachedExam) return res.json({ success: true, data: cachedExam });

    const { exam, error } = await fetchExamByIdentifier(path);
    if (error || !exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    await enrichExamDetails(exam, req.user);
    await redisCache.set(cacheKey, exam, CACHE_TTL.EXAM_DETAILS);
    res.json({ success: true, data: exam });
  } catch (error) {
    logger.error('Get exam by short path error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exam details' });
  }
};

const getExamByPath = async (req, res) => {
  try {
    const { category, subcategory, examSlug } = req.params;
    const path = `/${category}/${subcategory}/${examSlug}`;
    const cacheKey = buildExamDetailCacheKey(path);
    const cachedExam = await redisCache.get(cacheKey);
    if (cachedExam) return res.json({ success: true, data: cachedExam });

    const { exam, error } = await fetchExamByIdentifier(path);
    if (error || !exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    await enrichExamDetails(exam, req.user);
    res.json({ success: true, data: exam });
  } catch (error) {
    logger.error('Get exam by path error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exam details' });
  }
};

const getExamById = async (req, res) => {
  try {
    const { id } = req.params;
    const { attemptId } = req.query || {};

    const cacheKey = buildExamDetailCacheKey(id);
    const cachedExam = await redisCache.get(cacheKey);
    if (cachedExam) return res.json({ success: true, data: cachedExam });

    let { exam, error } = await fetchExamByIdentifier(id);

    // Allow access to unpublished exams if user has an attempt
    if ((error || !exam) && req.user) {
      const { data: unpublishedExam, error: unpublishedError } = await supabase
        .from('exams')
        .select('id, title, duration, total_marks, total_questions, category, difficulty, status, start_date, end_date, pass_percentage, is_free, image_url, logo_url, thumbnail_url, pdf_url_en, pdf_url_hi, negative_marking, negative_mark_value, allow_anytime, exam_type, is_premium, slug, url_path')
        .eq('id', id)
        .is('deleted_at', null)
        .single();

      if (!unpublishedError && unpublishedExam) {
        const { data: userAttempts } = await supabase
          .from('exam_attempts')
          .select('id')
          .eq('exam_id', id)
          .eq('user_id', req.user.id)
          .order('created_at', { ascending: false })
          .limit(1);

        if (userAttempts && userAttempts.length > 0) {
          exam = unpublishedExam;
          error = null;
        }
      }
    }

    if ((error || !exam) && attemptId) {
      const { data: attempt } = await supabase
        .from('exam_attempts')
        .select('id, user_id')
        .eq('id', attemptId)
        .eq('exam_id', id)
        .single();

      if (attempt) {
        const { data: unpublishedExamByAttempt, error: attemptExamError } = await supabase
          .from('exams')
          .select('id, title, duration, total_marks, total_questions, category, difficulty, status, start_date, end_date, pass_percentage, is_free, image_url, logo_url, thumbnail_url, pdf_url_en, pdf_url_hi, negative_marking, negative_mark_value, allow_anytime, exam_type, is_premium, slug, url_path')
          .eq('id', id)
          .is('deleted_at', null)
          .single();

        if (!attemptExamError && unpublishedExamByAttempt) {
          exam = unpublishedExamByAttempt;
          error = null;
        }
      }
    }

    if (error || !exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    await enrichExamDetails(exam, req.user);
    res.json({ success: true, data: exam });
  } catch (error) {
    logger.error('Get exam by ID error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exam details' });
  }
};

const getExamCategories = async (req, res) => {
  try {
    const { data: categories, error } = await supabase
      .from('exams')
      .select('category')
      .eq('is_published', true)
      .is('deleted_at', null);

    if (error) {
      logger.error('Get categories error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch categories' });
    }

    const uniqueCategories = [...new Set(categories.map(c => c.category))];
    res.json({ success: true, data: uniqueCategories });
  } catch (error) {
    logger.error('Get categories error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch categories' });
  }
};

const startExam = async (req, res) => {
  try {
    const { examId } = req.params;
    const { language = 'en' } = req.body;

    const { exam, error: examError } = await fetchExamByIdentifier(examId);
    if (examError || !exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    const resolvedExamId = exam.id;

    if (!exam.allow_anytime) {
      const now = new Date();
      const normalizedStatus = (exam.status || '').toLowerCase().trim();
      const isLiveStatus = normalizedStatus === 'ongoing' || normalizedStatus === 'live' ||
        normalizedStatus === 'live now' || normalizedStatus.includes('live');
      const hasWindow = exam.start_date && exam.end_date;
      const windowStarted = hasWindow && new Date(exam.start_date) <= now;
      const windowEnded = hasWindow && new Date(exam.end_date) < now;
      const withinWindow = hasWindow && windowStarted && !windowEnded;

      if (!isLiveStatus && !withinWindow) {
        if (hasWindow && !windowStarted) return res.status(400).json({ success: false, message: 'Exam has not started yet' });
        if (hasWindow && windowEnded) return res.status(400).json({ success: false, message: 'Exam attempt window has closed' });
        return res.status(400).json({ success: false, message: 'Exam is not currently available' });
      }
    }

    if (language !== 'en' && language !== 'hi') {
      return res.status(400).json({ success: false, message: 'Invalid language. Must be "en" or "hi"' });
    }
    if (language === 'hi' && !exam.supports_hindi) {
      return res.status(400).json({ success: false, message: 'Hindi language not supported for this exam' });
    }

    let hasExamAccess = Boolean(exam.is_free);
    const accessDeniedMessage = 'Premium subscription required to access this exam';

    // An active subscription unlocks EVERY paid exam — the product is the
    // "All Exams Test Series". We deliberately do NOT gate this on the
    // exam.is_premium flag: any non-free exam is covered by a subscription.
    // This matches the frontend access model (requiresUnlock = !is_free &&
    // !user.is_premium), which never inspects exam.is_premium. Gating on
    // is_premium here blocked subscribers from non-free exams that weren't
    // explicitly flagged premium.
    if (!hasExamAccess) {
      hasExamAccess = await hasPremiumExamAccess(req.user.id);
    }

    if (!hasExamAccess) {
      const { data: payment } = await supabase
        .from('transactions')
        .select('id')
        .eq('user_id', req.user.id)
        .eq('exam_id', resolvedExamId)
        .eq('status', 'success')
        .single();

      hasExamAccess = Boolean(payment);
    }

    if (!hasExamAccess) {
      return res.status(403).json({ success: false, message: accessDeniedMessage });
    }

    const { data: attempt, error: attemptError } = await supabase
      .from('exam_attempts')
      .insert({
        exam_id: resolvedExamId,
        user_id: req.user.id,
        language,
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      })
      .select('id, started_at, language')
      .single();

    if (attemptError) {
      logger.error('Start exam error:', attemptError);
      return res.status(500).json({ success: false, message: 'Failed to start exam' });
    }

    // Atomically increment the attempts counter in the exams table
    try {
      await supabase.rpc('increment_exam_attempts', { exam_id: resolvedExamId });
    } catch (incError) {
      // Fallback if RPC doesn't exist: Manual increment
      logger.warn('Failed to call increment_exam_attempts RPC, falling back to manual update', incError);
      await supabase
        .from('exams')
        .update({ attempts: (exam.attempts || 0) + 1 })
        .eq('id', resolvedExamId);
    }

    res.json({
      success: true,
      message: 'Exam started successfully',
      data: { attemptId: attempt.id, startedAt: attempt.started_at, language: attempt.language },
    });
  } catch (error) {
    logger.error('Start exam error:', error);
    res.status(500).json({ success: false, message: 'Failed to start exam' });
  }
};

const getExamQuestions = async (req, res) => {
  try {
    const { examId, attemptId } = req.params;

    logger.info('getExamQuestions called:', { examId, attemptId, userId: req.user?.id });

    const { data: attemptCheck } = await supabase
      .from('exam_attempts')
      .select('id, exam_id, user_id, is_submitted, language')
      .eq('id', attemptId)
      .single();

    const { data: attempt, error: attemptError } = await supabase
      .from('exam_attempts')
      .select('id, exam_id, user_id, is_submitted, language')
      .eq('id', attemptId)
      .eq('exam_id', examId)
      .eq('user_id', req.user.id)
      .single();

    if (attemptError || !attempt) {
      return res.status(404).json({
        success: false,
        message: 'Exam attempt not found',
        debug: {
          attemptExists: !!attemptCheck,
          attemptBelongsToUser: attemptCheck?.user_id === req.user.id,
          attemptBelongsToExam: attemptCheck?.exam_id === examId,
        },
      });
    }

    if (attempt.is_submitted) return res.status(400).json({ success: false, message: 'Exam already submitted' });

    // Allow ?lang query override (user can change language preference before starting)
    const queryLang = req.query.lang;
    const attemptLanguage = (queryLang === 'hi' || queryLang === 'en') ? queryLang : (attempt.language || 'en');

    let sectionsData, sectionsError;
    try {
      ({ data: sectionsData, error: sectionsError } = await supabase
        .from('exam_sections')
        .select('id, name, name_hi, total_questions, marks_per_question, duration, section_order, language')
        .eq('exam_id', examId)
        .order('section_order'));

      if (sectionsError && sectionsError.code === '42703') {
        ({ data: sectionsData, error: sectionsError } = await supabase
          .from('exam_sections')
          .select('id, name, name_hi, total_questions, marks_per_question, duration, section_order')
          .eq('exam_id', examId)
          .order('section_order'));
      }
    } catch (err) {
      sectionsData = null;
      sectionsError = err;
    }

    if (sectionsError) {
      logger.error('Get sections error:', sectionsError);
      return res.status(500).json({ success: false, message: 'Failed to fetch exam sections' });
    }

    // Use the section's own language when set; otherwise leave as null so languageUsed (resolved after filtering) takes over
    const sections = (sectionsData || []).map(s => ({ ...s, language: s.language || null }));

    const { data: questions, error: questionsError } = await supabase
      .from('questions')
      .select(`
        id, section_id, type, text, text_hi, marks, negative_marks,
        explanation, explanation_hi, explanation_image_url, image_url, question_order, question_number,
        question_options (
          id, option_text, option_text_hi, option_order, image_url,
          imageUrl:image_url
        )
      `)
      .eq('exam_id', examId)
      .is('deleted_at', null)
      .order('question_number');

    if (questionsError) {
      logger.error('Get questions error:', questionsError);
      return res.status(500).json({ success: false, message: 'Failed to fetch questions' });
    }

    const { data: userAnswers } = await supabase
      .from('user_answers')
      .select('question_id, answer, marked_for_review, time_taken')
      .eq('attempt_id', attemptId);

    const questionHasContent = (question, language) => {
      if (language === 'hi') {
        return Boolean(
          (question.text_hi && question.text_hi.trim()) ||
          (question.explanation_hi && question.explanation_hi.trim()) ||
          (question.image_url && question.image_url.trim()) ||
          (question.question_options && question.question_options.some(opt =>
            (opt.option_text_hi && opt.option_text_hi.trim()) || (opt.image_url && opt.image_url.trim())
          ))
        );
      }
      return Boolean(
        (question.text && question.text.trim()) ||
        (question.explanation && question.explanation.trim()) ||
        (question.image_url && question.image_url.trim()) ||
        (question.question_options && question.question_options.some(opt =>
          (opt.option_text && opt.option_text.trim()) || (opt.image_url && opt.image_url.trim())
        ))
      );
    };

    const buildFilteredQuestions = (language) => {
      const filtered = questions.filter(q => questionHasContent(q, language));
      logger.info(`Filtered questions for language ${language}: ${filtered.length}/${questions.length}`);
      return filtered;
    };

    let languageUsed = attemptLanguage;
    let filteredQuestions = buildFilteredQuestions(languageUsed);

    if (filteredQuestions.length === 0 && attemptLanguage === 'hi') {
      languageUsed = 'en';
      filteredQuestions = buildFilteredQuestions(languageUsed);
    }
    if (filteredQuestions.length === 0) {
      languageUsed = 'en';
      filteredQuestions = questions;
    }

    const questionsWithAnswers = filteredQuestions.map(q => ({
      ...q,
      options: q.question_options?.sort((a, b) => a.option_order - b.option_order) || [],
      userAnswer: userAnswers?.find(ua => ua.question_id === q.id) || null,
    }));

    const sectionQuestionMap = new Map();
    const sectionLanguageMap = new Map();
    sections.forEach(s => sectionLanguageMap.set(s.id, s.language || 'en'));
    questionsWithAnswers.forEach(q => {
      if (!sectionQuestionMap.has(q.section_id)) sectionQuestionMap.set(q.section_id, []);
      sectionQuestionMap.get(q.section_id).push(q);
    });

    const sectionsWithQuestions = sections
      .map(section => {
        const sectionQuestions = (sectionQuestionMap.get(section.id) || [])
          .sort((a, b) => (a.question_number || a.question_order || 0) - (b.question_number || b.question_order || 0));
        if (sectionQuestions.length === 0) return null;
        return {
          id: section.id, name: section.name, name_hi: section.name_hi || null,
          // Always report the actual content language so the frontend renders correctly
          language: languageUsed,
          totalQuestions: sectionQuestions.length,
          marksPerQuestion: section.marks_per_question, duration: section.duration,
          sectionOrder: section.section_order, questions: sectionQuestions,
        };
      })
      .filter(Boolean);

    logger.info(`Final response for exam ${examId}, attempt ${attemptId}:`, {
      total_questions: questionsWithAnswers.length,
      sections_count: sectionsWithQuestions.length,
    });

    res.json({ success: true, data: { sections: sectionsWithQuestions, questions: questionsWithAnswers } });
  } catch (error) {
    logger.error('Get exam questions error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exam questions' });
  }
};

const saveAnswer = async (req, res) => {
  try {
    const { attemptId, questionId } = req.params;
    const { answer, markedForReview, timeTaken, timeRemaining } = req.body;

    const { data: attempt } = await supabase
      .from('exam_attempts')
      .select('id, exam_id, user_id, is_submitted')
      .eq('id', attemptId)
      .eq('user_id', req.user.id)
      .single();

    if (!attempt) return res.status(404).json({ success: false, message: 'Exam attempt not found' });
    if (attempt.is_submitted) return res.status(400).json({ success: false, message: 'Cannot save answer after exam submission' });

    const { data: existingAnswer } = await supabase
      .from('user_answers')
      .select('id')
      .eq('attempt_id', attemptId)
      .eq('question_id', questionId)
      .single();

    const hasAnswerValue = (value) => {
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'string') return value.trim().length > 0;
      return Boolean(value);
    };

    const hasAnswer = hasAnswerValue(answer);
    const isMarked = markedForReview || false;

    if (existingAnswer) {
      if (!hasAnswer && !isMarked) {
        await supabase.from('user_answers').delete().eq('id', existingAnswer.id);
      } else {
        await supabase.from('user_answers')
          .update({ answer: hasAnswer ? answer : null, marked_for_review: isMarked, time_taken: timeTaken || 0 })
          .eq('id', existingAnswer.id);
      }
    } else if (hasAnswer || isMarked) {
      await supabase.from('user_answers').insert({
        attempt_id: attemptId, question_id: questionId,
        answer: hasAnswer ? answer : null, marked_for_review: isMarked, time_taken: timeTaken || 0,
      });
    }

    // Persist remaining time so the timer survives tab close / session change
    const attemptUpdate = { updated_at: new Date().toISOString() };
    if (typeof timeRemaining === 'number' && timeRemaining >= 0) {
      attemptUpdate.time_remaining = timeRemaining;
    }
    await supabase
      .from('exam_attempts')
      .update(attemptUpdate)
      .eq('id', attemptId);

    // Invalidate resume cache so the next GET reflects new time_remaining + answer count
    await redisCache.del(resumeCacheKey(req.user.id, attempt.exam_id));

    res.json({ success: true, message: 'Answer saved successfully' });
  } catch (error) {
    logger.error('Save answer error:', error);
    res.status(500).json({ success: false, message: 'Failed to save answer' });
  }
};

const submitExam = async (req, res) => {
  try {
    const { attemptId } = req.params;

    const { data: attempt } = await supabase
      .from('exam_attempts')
      .select('id, exam_id, user_id, started_at, is_submitted')
      .eq('id', attemptId)
      .eq('user_id', req.user.id)
      .single();

    if (!attempt) return res.status(404).json({ success: false, message: 'Exam attempt not found' });
    if (attempt.is_submitted) return res.status(400).json({ success: false, message: 'Exam already submitted' });

    const submittedAt = new Date();
    const timeTaken = Math.floor((submittedAt - new Date(attempt.started_at)) / 1000);

    await supabase.from('exam_attempts')
      .update({ is_submitted: true, submitted_at: submittedAt.toISOString(), time_taken: timeTaken })
      .eq('id', attemptId);

    // Invalidate resume cache — attempt is no longer resumable
    await redisCache.del(resumeCacheKey(attempt.user_id, attempt.exam_id));

    await evaluateExam(attemptId, attempt.exam_id, req.user.id);
    await redisCache.deleteByPattern(`bharat_mock:exam-detail:${attempt.exam_id}*`);

    res.json({ success: true, message: 'Exam submitted successfully', data: { attemptId, submittedAt } });
  } catch (error) {
    logger.error('Submit exam error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit exam' });
  }
};

const evaluateExam = async (attemptId, examId, userId) => {
  try {
    const sectionsPromise = supabase
      .from('exam_sections')
      .select('id, name, name_hi, total_questions, marks_per_question, duration, section_order, language')
      .eq('exam_id', examId)
      .then(r => {
        if (r.error && r.error.code === '42703') {
          return supabase.from('exam_sections')
            .select('id, name, name_hi, total_questions, marks_per_question, duration, section_order')
            .eq('exam_id', examId);
        }
        return r;
      });

    const [attemptRes, sectionsRes, questionsRes, answersRes, examRes] = await Promise.all([
      supabase.from('exam_attempts').select('language, time_taken').eq('id', attemptId).single(),
      sectionsPromise,
      supabase.from('questions')
        .select('id, section_id, type, text, text_hi, marks, negative_marks, question_options!inner(id, is_correct, option_text, option_text_hi)')
        .eq('exam_id', examId),
      supabase.from('user_answers').select('id, question_id, answer, time_taken').eq('attempt_id', attemptId),
      supabase.from('exams').select('total_marks, pass_percentage').eq('id', examId).single(),
    ]);

    const attemptLanguage = attemptRes.data?.language || 'en';
    const attemptTimeTaken = attemptRes.data?.time_taken || 0;
    const sectionsData = sectionsRes.data || [];
    const questions = questionsRes.data || [];
    const userAnswers = answersRes.data || [];
    const exam = examRes.data;

    const sectionMap = {};
    sectionsData.forEach(s => { sectionMap[s.id] = { ...s, language: s.language || attemptLanguage }; });

    const allowedSectionIds = new Set(
      Object.values(sectionMap).filter(s => s.language === attemptLanguage).map(s => s.id)
    );

    const questionHasContent = (question, language) => {
      if (language === 'hi') {
        return Boolean(
          (question.text_hi && question.text_hi.trim()) ||
          (question.explanation_hi && question.explanation_hi.trim()) ||
          (question.image_url && question.image_url.trim()) ||
          (question.question_options && question.question_options.some(opt => 
            (opt.option_text_hi && opt.option_text_hi.trim()) || (opt.image_url && opt.image_url.trim())
          ))
        );
      }
      return Boolean(
        (question.text && question.text.trim()) ||
        (question.explanation && question.explanation.trim()) ||
        (question.image_url && question.image_url.trim()) ||
        (question.question_options && question.question_options.some(opt => 
          (opt.option_text && opt.option_text.trim()) || (opt.image_url && opt.image_url.trim())
        ))
      );
    };

    let languageUsed = attemptLanguage;
    let filteredQuestions = questions.filter(q =>
      allowedSectionIds.has(q.section_id) && questionHasContent(q, languageUsed)
    );

    if (filteredQuestions.length === 0 && attemptLanguage === 'hi') {
      languageUsed = 'en';
      filteredQuestions = questions.filter(q =>
        allowedSectionIds.has(q.section_id) && questionHasContent(q, languageUsed)
      );
    }
    
    if (filteredQuestions.length === 0) {
      languageUsed = 'en';
      filteredQuestions = questions.filter(q => allowedSectionIds.has(q.section_id));
    }

    if (filteredQuestions.length === 0) throw new Error('No questions available for evaluation in selected language');

    const sectionTotals = {};
    filteredQuestions.forEach(q => {
      if (!sectionTotals[q.section_id]) sectionTotals[q.section_id] = { totalMarks: 0, totalQuestions: 0 };
      sectionTotals[q.section_id].totalMarks += q.marks || 0;
      sectionTotals[q.section_id].totalQuestions += 1;
    });

    const attemptTotalMarks = Object.values(sectionTotals).reduce((sum, s) => sum + s.totalMarks, 0) || 0;
    const answerMap = new Map();
    userAnswers.forEach(ua => answerMap.set(ua.question_id, ua));

    let totalScore = 0, correctAnswers = 0, wrongAnswers = 0, unattempted = 0;
    const sectionScores = {};
    const answerUpdates = [];

    for (const question of filteredQuestions) {
      const userAnswer = answerMap.get(question.id);
      if (!sectionScores[question.section_id]) {
        sectionScores[question.section_id] = { score: 0, correct: 0, wrong: 0, unattempted: 0, timeTaken: 0 };
      }

      if (!userAnswer || !userAnswer.answer) {
        unattempted++;
        sectionScores[question.section_id].unattempted++;
        if (userAnswer) answerUpdates.push({ id: userAnswer.id, is_correct: false, marks_obtained: 0 });
        continue;
      }

      const correctOptions = question.question_options.filter(opt => opt.is_correct).map(opt => opt.id);
      let isCorrect = false;

      if (question.type === 'single' || question.type === 'truefalse') {
        isCorrect = correctOptions.map(String).includes(String(userAnswer.answer));
      } else if (question.type === 'multiple') {
        let userAnswerArray;
        try {
          userAnswerArray = Array.isArray(userAnswer.answer) ? userAnswer.answer : JSON.parse(userAnswer.answer);
        } catch (_e) {
          userAnswerArray = [userAnswer.answer];
        }
        const userSet = userAnswerArray.map(String);
        const correctSet = correctOptions.map(String);
        isCorrect = correctSet.length === userSet.length && correctSet.every(o => userSet.includes(o));
      } else if (question.type === 'numerical') {
        isCorrect = parseFloat(userAnswer.answer) === parseFloat(correctOptions[0]);
      }

      const marksObtained = isCorrect ? question.marks : -(question.negative_marks || 0);
      totalScore += marksObtained;

      if (isCorrect) { correctAnswers++; sectionScores[question.section_id].correct++; }
      else { wrongAnswers++; sectionScores[question.section_id].wrong++; }

      sectionScores[question.section_id].score += marksObtained;
      sectionScores[question.section_id].timeTaken += userAnswer.time_taken || 0;
      answerUpdates.push({ id: userAnswer.id, is_correct: isCorrect, marks_obtained: marksObtained });
    }

    for (const [sectionId, totals] of Object.entries(sectionTotals)) {
      if (!sectionScores[sectionId]) {
        sectionScores[sectionId] = { score: 0, correct: 0, wrong: 0, unattempted: totals.totalQuestions, timeTaken: 0 };
      } else {
        const s = sectionScores[sectionId];
        s.unattempted = Math.max(totals.totalQuestions - s.correct - s.wrong, 0);
      }
    }

    const BATCH_SIZE = 50;
    const updatePromises = [];
    for (let i = 0; i < answerUpdates.length; i += BATCH_SIZE) {
      const batch = answerUpdates.slice(i, i + BATCH_SIZE);
      updatePromises.push(
        Promise.all(batch.map(u =>
          supabase.from('user_answers')
            .update({ is_correct: u.is_correct, marks_obtained: u.marks_obtained })
            .eq('id', u.id)
        ))
      );
    }

    const denominator = attemptTotalMarks || exam.total_marks;
    const percentage = denominator > 0 ? (totalScore / denominator) * 100 : 0;
    const status = percentage >= exam.pass_percentage ? 'pass' : 'fail';

    const [resultRes] = await Promise.all([
      supabase.from('results').insert({
        attempt_id: attemptId, exam_id: examId, user_id: userId,
        score: totalScore, total_marks: denominator, percentage,
        correct_answers: correctAnswers, wrong_answers: wrongAnswers,
        unattempted, time_taken: attemptTimeTaken, status, is_published: true,
      }).select('id').single(),
      ...updatePromises,
    ]);

    const result = resultRes.data;

    const sectionAnalysisRows = [];
    for (const [sectionId, scores] of Object.entries(sectionScores)) {
      const section = sectionMap[sectionId];
      if (!section || section.language !== attemptLanguage) continue;
      const sectionTotal = sectionTotals[sectionId]?.totalMarks || (section.total_questions * section.marks_per_question);
      const accuracy = (scores.correct + scores.wrong) > 0
        ? (scores.correct / (scores.correct + scores.wrong)) * 100 : 0;
      sectionAnalysisRows.push({
        result_id: result.id, section_id: sectionId, score: scores.score,
        total_marks: sectionTotal, correct_answers: scores.correct,
        wrong_answers: scores.wrong, unattempted: scores.unattempted,
        accuracy, time_taken: scores.timeTaken,
      });
    }

    if (sectionAnalysisRows.length > 0) {
      await supabase.from('section_analysis').insert(sectionAnalysisRows);
    }

    return result.id;
  } catch (error) {
    logger.error('Evaluate exam error:', error);
    throw error;
  }
};

const getExamForPDF = async (req, res) => {
  try {
    const { examId } = req.params;

    const { data: exam, error: examError } = await supabase
      .from('exams')
      .select('*, exam_categories(name, slug), exam_subcategories(name, slug), exam_difficulties(name)')
      .eq('id', examId)
      .eq('is_published', true)
      .is('deleted_at', null)
      .single();

    if (examError || !exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    const { data: sections, error: sectionsError } = await supabase
      .from('exam_sections')
      .select('*')
      .eq('exam_id', examId)
      .order('section_order', { ascending: true });

    if (sectionsError) {
      logger.error('Get sections error:', sectionsError);
      return res.status(500).json({ success: false, message: 'Failed to fetch exam sections' });
    }

    const { data: questions, error: questionsError } = await supabase
      .from('questions')
      .select('*, question_options(*)')
      .eq('exam_id', examId)
      .order('question_number', { ascending: true });

    if (questionsError) {
      logger.error('Get questions error:', questionsError);
      return res.status(500).json({ success: false, message: 'Failed to fetch exam questions' });
    }

    const questionsWithOptions = questions.map(q => ({
      ...q,
      options: (q.question_options || []).sort((a, b) => (a.option_order ?? 0) - (b.option_order ?? 0)),
    }));

    res.json({ success: true, data: { exam, sections, questions: questionsWithOptions } });
  } catch (error) {
    logger.error('Get exam for PDF error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exam data for PDF' });
  }
};

const RESUME_TTL = 60; // 60 seconds — short TTL since time_remaining changes frequently
const resumeCacheKey = (userId, examId) => buildCacheKey('resume_attempts', userId, examId);

const getResumeAttempts = async (req, res) => {
  try {
    const { examId } = req.params;
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    // Check Redis first
    const key = resumeCacheKey(userId, examId);
    const cached = await redisCache.get(key);
    if (cached) {
      return res.json({ success: true, data: cached });
    }

    const { data: attempts, error } = await supabase
      .from('exam_attempts')
      .select('id, exam_id, started_at, language, time_remaining, updated_at')
      .eq('exam_id', examId)
      .eq('user_id', userId)
      .eq('is_submitted', false)
      .order('updated_at', { ascending: false })
      .limit(5);

    if (error) {
      logger.error('getResumeAttempts error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch resume attempts' });
    }

    if (!attempts?.length) {
      await redisCache.set(key, [], RESUME_TTL);
      return res.json({ success: true, data: [] });
    }

    // Enrich with answered question count
    const enriched = await Promise.all(attempts.map(async (attempt) => {
      const { count } = await supabase
        .from('user_answers')
        .select('id', { count: 'exact', head: true })
        .eq('attempt_id', attempt.id)
        .not('answer', 'is', null);
      return { ...attempt, answered_count: count || 0 };
    }));

    await redisCache.set(key, enriched, RESUME_TTL);
    return res.json({ success: true, data: enriched });
  } catch (err) {
    logger.error('getResumeAttempts error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Public: all published short_quiz exams enriched with their Test Series
// section/topic NAMES so the /quizzes page can group them (Section tabs → Topic
// pills, pooled across series). Section/topic names are bulk-resolved in a single
// extra query each to avoid N round-trips.
const getQuizGroups = async (req, res) => {
  try {
    const limitNum = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 1000));

    const metadata = await batchLoadCategoriesAndSubcategories();

    const { data: exams, error } = await supabase
      .from('exams')
      .select(
        'id, title, duration, total_marks, total_questions, category_id, subcategory_id, difficulty, difficulty_id, status, start_date, end_date, exam_date, is_free, image_url, logo_url, thumbnail_url, allow_anytime, supports_hindi, exam_type, is_premium, slug, url_path, created_at, attempts, test_series_id, test_series_section_id, test_series_topic_id'
      )
      .eq('is_published', true)
      .eq('exam_type', 'short_quiz')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limitNum);

    if (error) {
      logger.error('Error fetching quizzes:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch quizzes', error: error.message });
    }

    const quizzes = exams || [];

    // Bulk-resolve section & topic names referenced by these quizzes.
    const sectionIds = [...new Set(quizzes.map(q => q.test_series_section_id).filter(Boolean))];
    const topicIds = [...new Set(quizzes.map(q => q.test_series_topic_id).filter(Boolean))];

    const [sectionsRes, topicsRes] = await Promise.all([
      sectionIds.length
        ? supabase.from('test_series_sections').select('id, name, display_order').in('id', sectionIds)
        : Promise.resolve({ data: [] }),
      topicIds.length
        ? supabase.from('test_series_topics').select('id, name, display_order').in('id', topicIds)
        : Promise.resolve({ data: [] }),
    ]);

    const sectionMap = Object.fromEntries((sectionsRes.data || []).map(s => [s.id, s]));
    const topicMap = Object.fromEntries((topicsRes.data || []).map(t => [t.id, t]));

    const data = quizzes.map(exam => {
      const section = exam.test_series_section_id ? sectionMap[exam.test_series_section_id] : null;
      const topic = exam.test_series_topic_id ? topicMap[exam.test_series_topic_id] : null;
      return {
        ...exam,
        exam_categories: exam.category_id ? metadata.categoriesMap[exam.category_id] : null,
        exam_subcategories: exam.subcategory_id ? metadata.subcategoriesMap[exam.subcategory_id] : null,
        section_name: section?.name || null,
        section_order: section?.display_order ?? null,
        topic_name: topic?.name || null,
        topic_order: topic?.display_order ?? null,
      };
    });

    res.json({ success: true, data, total: data.length });
  } catch (error) {
    logger.error('Error in getQuizGroups:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

module.exports = {
  getExams,
  getQuizGroups,
  getExamHistory,
  getExamByShortPath,
  getExamByPath,
  getExamById,
  getExamCategories,
  startExam,
  getExamQuestions,
  saveAnswer,
  submitExam,
  getExamForPDF,
  getResumeAttempts,
};
