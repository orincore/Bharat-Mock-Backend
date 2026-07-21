const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { redisCache, buildCacheKey } = require('../utils/redisCache');

// Bust all language variants of an exam's translation cache
const bustExamTranslationCache = async (examId) => {
  if (!examId) return;
  await redisCache.deleteByPattern(buildCacheKey('exam_translations', examId, '*'));
  logger.info(`[Cache] Busted exam_translations:${examId}:*`);
};

// Bust the cached exam listings + the derived "years" filter.
// The year filter on exam pages is computed from published exams' exam_date and
// cached under `exam_years`; the per-query exam listings embed that years array.
// Call this after any create/update/delete so a removed/changed year disappears
// from the filter immediately instead of lingering until the cache TTL expires.
const bustExamListCaches = async () => {
  await redisCache.del(buildCacheKey('exam_years'));
  await redisCache.deleteByPattern(buildCacheKey('exams', '*'));
  // Also drop the per-exam DETAIL cache. It is keyed `exam-detail:*` (by id,
  // url_path, slug and short path), which the `exams:*` pattern above does NOT
  // match — so without this, editing any exam field (instructions, marks, dates…)
  // stayed invisible on the detail/attempt page until the TTL expired.
  await redisCache.deleteByPattern('exam-detail:*');
  logger.info('[Cache] Busted exam_years + exams:* listings + exam-detail:*');
};
const { uploadExamLogo, uploadExamThumbnail, uploadExamPdfEn, uploadExamPdfHi, uploadQuestionImage, uploadOptionImage, uploadExplanationImage, deleteFile, extractKeyFromUrl } = require('../services/uploadService');
const { fetchExamPdfData } = require('../utils/examPdfData');
const { buildExamPdfDocument } = require('../utils/examPdfHtml');
const { renderExamPdf } = require('../utils/pdfBrowser');

const PDF_BASE_URL = process.env.PDF_BASE_URL || process.env.FRONTEND_URL || 'https://bharatmock.com';
const pdfFileName = (title) =>
  `${String(title || 'exam').replace(/[\\/:*?"<>|]+/g, '').trim() || 'exam'}.pdf`;

// Admin: render ANY exam (published or not) to a PDF with full option control —
// answers/explanations, language, watermark, cover page, header/footer text and
// cover/footer/back banners (data URLs). Options come from the request body.
const generateExamPdf = async (req, res) => {
  try {
    const { examId } = req.params;
    const body = req.body || {};

    const data = await fetchExamPdfData(prisma, examId, { publishedOnly: false });
    if (!data) return res.status(404).json({ success: false, message: 'Exam not found' });

    const built = await buildExamPdfDocument(data, {
      showAnswers: body.showAnswers !== false,
      showExplanations: body.showExplanations !== false,
      language: body.language === 'hi' ? 'hi' : 'en',
      showWatermark: body.showWatermark !== false,
      showCoverPage: body.showCoverPage !== false,
      headerText: typeof body.headerText === 'string' ? body.headerText : '',
      footerText: typeof body.footerText === 'string' ? body.footerText : '',
      coverBanner: body.coverBanner || null,
      footerBanner: body.footerBanner || null,
      backCoverBanner: body.backCoverBanner || null,
      baseUrl: PDF_BASE_URL,
    });

    const pdf = await renderExamPdf(built);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfFileName(data.exam.title)}"`);
    res.setHeader('Content-Length', pdf.length);
    return res.end(pdf);
  } catch (error) {
    logger.error('Admin generate exam PDF error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, message: 'Failed to generate exam PDF' });
    }
    return res.end();
  }
};
const { slugify, ensureUniqueSlug } = require('../utils/slugify');
const { sendRoleChangedEmail, sendSubscriptionActivatedEmail } = require('../utils/emailService');

const safeAverage = (numbers = []) => {
  const valid = numbers.filter((n) => typeof n === 'number' && !Number.isNaN(n));
  if (valid.length === 0) return 0;
  return parseFloat((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(1));
};

// Prisma's DateTime fields require a full ISO-8601 timestamp. Admin forms send
// date-only strings (e.g. "2026-07-14"), which fail with "premature end of
// input. Expected ISO-8601 DateTime." unless coerced through `new Date()` first.
const toDateOrNull = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Generate a unique exam UID in BHMK######X format, verified against DB
const generateUniqueExamUid = async () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const gen = () => {
    const num = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    const letter = chars[Math.floor(Math.random() * chars.length)];
    return `BHMK${num}${letter}`;
  };
  let uid = gen();
  for (let i = 0; i < 20; i++) {
    const existing = await prisma.exams.findFirst({ where: { exam_uid: uid }, select: { id: true } });
    if (!existing) return uid;
    uid = gen();
  }
  throw new Error('Could not generate unique exam_uid after 20 attempts');
};

const QUESTION_BATCH_SIZE = 25;
const OPTION_BATCH_SIZE = 50;

// batchInsert now takes a Prisma model delegate (e.g. prisma.questions) instead of a
// table-name string. Uses createManyAndReturn (not plain createMany, which doesn't
// return rows) so callers can map generated ids back onto their in-memory question/
// option trees exactly like the original's insert().select(selectColumns) did —
// Postgres preserves row order for a single multi-row INSERT ... RETURNING, so the
// original's positional array alignment still holds. See MIGRATION_TRACKER.md §4.5g.
const batchInsert = async (model, rows, select = undefined, batchSize = QUESTION_BATCH_SIZE) => {
  if (!rows.length) return [];

  const chunks = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    chunks.push(rows.slice(i, i + batchSize));
  }

  // Fire all chunk inserts concurrently instead of awaiting them one at a time —
  // Promise.all preserves chunk order in the results array regardless of completion order,
  // so the final flattened list still lines up 1:1 with the input `rows` order.
  const results = await Promise.all(
    chunks.map((chunk, idx) =>
      model.createManyAndReturn(select ? { data: chunk, select } : { data: chunk })
        .then((data) => ({ data, idx }))
        .catch((error) => ({ error, idx }))
    )
  );

  const allCreated = [];
  for (const { data, error, idx } of results) {
    if (error) {
      const start = idx * batchSize;
      logger.error(`Batch insert error (chunk ${idx + 1}, rows ${start}-${start + chunks[idx].length - 1}):`, error);
    } else if (data) {
      allCreated.push(...data);
    }
  }

  if (allCreated.length !== rows.length) {
    logger.warn(`Expected ${rows.length} rows, inserted ${allCreated.length}`);
  }
  return allCreated;
};

const getAdminExams = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      category,
      subcategory,
      difficulty,
      exam_type,
      is_premium,
      is_published,
      is_free,
      date_from,
      date_to
    } = req.query;

    const pageNumber = parseInt(page, 10) || 1;
    const limitNumber = parseInt(limit, 10) || 10;
    const offset = (pageNumber - 1) * limitNumber;

    const where = {};

    // NOTE (disclosed simplification, not a silent bug fix): the original built a raw
    // ILIKE pattern with spaces replaced by '%' (e.g. "ssc cgl" -> "%ssc%cgl%"), which
    // matches "SSC Tier 1 CGL" (words in order, anything between) but not "CGL SSC"
    // (wrong order). Prisma's query builder has no equivalent for an arbitrary embedded
    // wildcard pattern without dropping to $queryRaw for this one admin-only internal
    // search box. Used plain case-insensitive `contains` on the literal search term
    // instead — matches a contiguous substring, which is simpler and, for the common
    // case of an admin searching a remembered phrase, an equally reasonable (arguably
    // more predictable) relevance behavior. Flagged here for the client; not a data
    // correctness or security-relevant change, purely an admin search UX nuance.
    if (search) {
      const searchTerm = search.trim().replace(/\s+/g, ' ');
      const hasSpecialChars = /[(),]/.test(searchTerm);
      if (hasSpecialChars) {
        where.title = { contains: searchTerm, mode: 'insensitive' };
      } else {
        where.OR = [
          { title: { contains: searchTerm, mode: 'insensitive' } },
          { slug: { contains: searchTerm, mode: 'insensitive' } },
          { exam_uid: { contains: searchTerm, mode: 'insensitive' } }
        ];
      }
    }

    if (status) where.status = status;
    if (category) where.category = category;
    if (subcategory) where.subcategory = subcategory;
    if (difficulty) where.difficulty = difficulty;
    if (exam_type && exam_type !== 'all') where.exam_type = exam_type;

    if (is_premium === 'true') where.is_premium = true;
    else if (is_premium === 'false') where.is_premium = false;

    if (is_published === 'true') where.is_published = true;
    else if (is_published === 'false') where.is_published = false;

    if (is_free === 'true') where.is_free = true;
    else if (is_free === 'false') where.is_free = false;

    if (date_from || date_to) {
      where.exam_date = {};
      if (date_from) where.exam_date.gte = new Date(date_from);
      if (date_to) where.exam_date.lte = new Date(date_to);
    }

    let exams, count;
    try {
      [exams, count] = await Promise.all([
        prisma.exams.findMany({
          where,
          select: {
            id: true, title: true, duration: true, total_marks: true, total_questions: true,
            category: true, subcategory: true, difficulty: true, status: true, start_date: true,
            end_date: true, pass_percentage: true, is_free: true, logo_url: true, thumbnail_url: true,
            negative_marking: true, negative_mark_value: true, is_published: true, exam_date: true,
            exam_type: true, show_in_mock_tests: true, is_premium: true, exam_uid: true,
            supports_hindi: true, pdf_url_en: true, pdf_url_hi: true, created_at: true, updated_at: true
          },
          orderBy: { created_at: 'desc' },
          skip: offset,
          take: limitNumber
        }),
        prisma.exams.count({ where })
      ]);
    } catch (error) {
      logger.error('Get admin exams error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch exams'
      });
    }

    res.json({
      success: true,
      data: exams,
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total: count || 0,
        totalPages: count ? Math.ceil(count / limitNumber) : 0
      }
    });
  } catch (error) {
    logger.error('Get admin exams error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching exams'
    });
  }
};

const getUserDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.users.findUnique({
      where: { id },
      select: {
        id: true, email: true, name: true, phone: true, bio: true, avatar_url: true, role: true,
        is_verified: true, is_blocked: true, block_reason: true, is_onboarded: true, auth_provider: true,
        is_premium: true, subscription_plan_id: true, subscription_expires_at: true,
        subscription_auto_renew: true, created_at: true, deleted_at: true
      }
    }).catch(() => null);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    let allResults;
    try {
      allResults = await prisma.results.findMany({
        where: { user_id: id, is_published: true },
        select: { score: true, total_marks: true, percentage: true, created_at: true, exam_id: true },
        orderBy: { created_at: 'desc' }
      });
    } catch (error) {
      logger.error('Admin fetch user results error:', error);
      allResults = [];
    }

    const recentResults = await prisma.results.findMany({
      where: { user_id: id, is_published: true },
      select: {
        id: true, score: true, total_marks: true, percentage: true, status: true, created_at: true, exam_id: true,
        exams: { select: { id: true, title: true, category: true, difficulty: true } }
      },
      orderBy: { created_at: 'desc' },
      take: 5
    }).catch(() => []);

    const recentAttempts = await prisma.exam_attempts.findMany({
      where: { user_id: id },
      select: {
        id: true, exam_id: true, started_at: true, submitted_at: true, time_taken: true, is_submitted: true,
        exams: { select: { id: true, title: true, category: true, difficulty: true } }
      },
      orderBy: { started_at: 'desc' },
      take: 5
    }).catch(() => []);

    const scores = (allResults || []).map((result) => Number(result.percentage) || 0);
    const stats = {
      totalExamsTaken: allResults?.length || 0,
      averageScore: safeAverage(scores),
      bestScore: scores.length ? Math.max(...scores) : 0,
      lastActive: allResults?.[0]?.created_at || user.created_at,
      totalMarksEarned: (allResults || []).reduce((sum, r) => sum + (Number(r.score) || 0), 0),
      totalMarksPossible: (allResults || []).reduce((sum, r) => sum + (Number(r.total_marks) || 0), 0)
    };

    res.json({
      success: true,
      data: {
        user,
        stats,
        recentResults: (recentResults || []).map((result) => ({
          ...result,
          exam: result.exams ? {
            id: result.exams.id,
            title: result.exams.title,
            category: result.exams.category,
            difficulty: result.exams.difficulty
          } : null
        })),
        recentAttempts: (recentAttempts || []).map((attempt) => ({
          ...attempt,
          exam: attempt.exams ? {
            id: attempt.exams.id,
            title: attempt.exams.title,
            category: attempt.exams.category,
            difficulty: attempt.exams.difficulty
          } : null
        }))
      }
    });
  } catch (error) {
    logger.error('Admin get user details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user details'
    });
  }
};

const getExamSectionsWithQuestions = async (req, res) => {
  try {
    const { id } = req.params;

    const exam = await prisma.exams.findFirst({ where: { id, deleted_at: null }, select: { id: true } });

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    let sections;
    try {
      sections = await prisma.exam_sections.findMany({
        where: { exam_id: id },
        select: { id: true, name: true, name_hi: true, total_questions: true, marks_per_question: true, duration: true, section_order: true },
        orderBy: { section_order: 'asc' }
      });
    } catch (error) {
      logger.error('Get sections error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch exam sections'
      });
    }

    let questions;
    try {
      questions = await prisma.questions.findMany({
        where: { exam_id: id, deleted_at: null },
        select: {
          id: true, section_id: true, passage_id: true, type: true, text: true, text_hi: true, marks: true, negative_marks: true,
          explanation: true, explanation_hi: true, explanation_image_url: true, difficulty: true, image_url: true,
          question_order: true, question_number: true,
          question_options: { select: { id: true, option_text: true, option_text_hi: true, is_correct: true, option_order: true, image_url: true } }
        },
        orderBy: [{ section_id: 'asc' }, { question_order: 'asc' }, { question_number: 'asc' }]
      });
    } catch (error) {
      logger.error('Get questions error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch exam questions'
      });
    }

    const sectionsWithQuestions = sections.map(section => ({
      id: section.id,
      name: section.name,
      name_hi: section.name_hi,
      total_questions: section.total_questions,
      marks_per_question: Number(section.marks_per_question),
      duration: section.duration,
      section_order: section.section_order,
      questions: questions
        .filter(q => q.section_id === section.id)
        .sort((a, b) => {
          const orderA = a.question_order ?? a.question_number ?? Number.MAX_SAFE_INTEGER;
          const orderB = b.question_order ?? b.question_number ?? Number.MAX_SAFE_INTEGER;
          return orderA - orderB;
        })
        .map(q => ({
          id: q.id,
          // Must be echoed back or the admin editor's "Linked Passage" dropdown
          // resets to "— No Passage —" on every reload: the write path saves the
          // link fine, but this mapper rebuilds the question object field by field,
          // so anything omitted here is invisible to the client.
          passage_id: q.passage_id,
          type: q.type,
          text: q.text,
          text_hi: q.text_hi,
          marks: Number(q.marks),
          negative_marks: Number(q.negative_marks),
          explanation: q.explanation,
          explanation_hi: q.explanation_hi,
          explanation_image_url: q.explanation_image_url,
          difficulty: q.difficulty,
          image_url: q.image_url,
          question_order: q.question_order,
          question_number: q.question_number,
          options: (q.question_options || [])
            .sort((a, b) => a.option_order - b.option_order)
            .map(opt => ({
              id: opt.id,
              option_text: opt.option_text,
              option_text_hi: opt.option_text_hi,
              is_correct: opt.is_correct,
              option_order: opt.option_order,
              image_url: opt.image_url
            }))
        }))
    }));

    res.json({
      success: true,
      data: sectionsWithQuestions
    });
  } catch (error) {
    logger.error('Get exam sections/questions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exam sections and questions'
    });
  }
};

const getAdminExamById = async (req, res) => {
  try {
    const { id } = req.params;

    const exam = await prisma.exams.findFirst({
      where: { id, deleted_at: null },
      select: {
        id: true, title: true, duration: true, total_marks: true, total_questions: true, category: true,
        category_id: true, subcategory: true, subcategory_id: true, difficulty: true, difficulty_id: true,
        status: true, start_date: true, end_date: true, pass_percentage: true, is_free: true, exam_type: true,
        show_in_mock_tests: true, is_premium: true, is_published: true, logo_url: true, thumbnail_url: true,
        pdf_url_en: true, pdf_url_hi: true, negative_marking: true, negative_mark_value: true, slug: true,
        url_path: true, syllabus: true, allow_anytime: true, is_test_series: true, test_series_id: true,
        test_series_section_id: true, test_series_topic_id: true, exam_date: true, display_order: true,
        paper_section_id: true, paper_topic_id: true, exam_uid: true, is_current_affair: true,
        instructions: true
      }
    }).catch(() => null);

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    const syllabusRows = await prisma.exam_syllabus.findMany({ where: { exam_id: id }, select: { topic: true } });

    exam.syllabus = syllabusRows?.map(row => row.topic) || exam.syllabus || [];
    // pass_percentage/negative_mark_value are Decimal — normalize to plain numbers
    // (see MIGRATION_TRACKER.md §4.5 for why supabase-js never had this issue).
    exam.pass_percentage = exam.pass_percentage !== null ? Number(exam.pass_percentage) : exam.pass_percentage;
    exam.negative_mark_value = exam.negative_mark_value !== null ? Number(exam.negative_mark_value) : exam.negative_mark_value;

    res.json({
      success: true,
      data: exam
    });
  } catch (error) {
    logger.error('Get admin exam error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exam details'
    });
  }
};

const createExam = async (req, res) => {
  try {
    const {
      title,
      duration,
      total_marks,
      total_questions,
      category,
      category_id,
      subcategory,
      subcategory_id,
      difficulty,
      difficulty_id,
      status,
      start_date,
      end_date,
      pass_percentage,
      is_free,
      negative_marking,
      negative_mark_value,
      syllabus,
      slug: customSlug,
      is_published,
      allow_anytime,
      exam_type,
      show_in_mock_tests,
      is_test_series,
      test_series_id,
      test_series_section_id,
      test_series_topic_id,
      exam_date,
      display_order,
      paper_section_id,
      paper_topic_id
    } = req.body;

    let logoUrl = null;
    let thumbnailUrl = null;

    if (req.files) {
      if (req.files.logo) {
        const logoResult = await uploadExamLogo(req.files.logo[0]);
        logoUrl = logoResult.url;
      }
      if (req.files.thumbnail) {
        const thumbnailResult = await uploadExamThumbnail(req.files.thumbnail[0]);
        thumbnailUrl = thumbnailResult.url;
      }
    }

    const examSlug = await ensureUniqueSlug(prisma.exams, slugify(customSlug || title));

    let categorySlug = category || '';
    let subcategorySlug = subcategory || '';

    if (category_id) {
      const cat = await prisma.exam_categories.findUnique({ where: { id: category_id }, select: { slug: true } });
      if (cat) categorySlug = cat.slug;
    }

    if (subcategory_id) {
      const subcat = await prisma.exam_subcategories.findUnique({ where: { id: subcategory_id }, select: { slug: true } });
      if (subcat) subcategorySlug = subcat.slug;
    }

    const parentSlug = subcategorySlug || categorySlug;
    const urlPath = parentSlug ? `/${parentSlug}/${examSlug}` : `/${examSlug}`;

    const parsedSyllabus = syllabus ? JSON.parse(syllabus) : [];
    const allowAnytimeFlag = allow_anytime === 'true' || allow_anytime === true;
    const normalizedStatus = allowAnytimeFlag ? 'anytime' : (status || 'upcoming');
    const normalizedStartDate = allowAnytimeFlag ? null : toDateOrNull(start_date);
    const normalizedEndDate = allowAnytimeFlag ? null : toDateOrNull(end_date);

    // Generate unique exam_uid in BHMK######X format
    const examUid = await generateUniqueExamUid();

    let exam;
    try {
      exam = await prisma.exams.create({
        data: {
          title,
          duration: parseInt(duration),
          total_marks: parseInt(total_marks),
          total_questions: parseInt(total_questions),
          category: category || categorySlug,
          category_id: category_id || null,
          subcategory: subcategory || subcategorySlug,
          subcategory_id: subcategory_id || null,
          difficulty: difficulty || null,
          difficulty_id: difficulty_id || null,
          status: normalizedStatus,
          start_date: normalizedStartDate,
          end_date: normalizedEndDate,
          pass_percentage: parseFloat(pass_percentage),
          is_free: is_free === 'true' || is_free === true,
          negative_marking: negative_marking === 'true' || negative_marking === true,
          negative_mark_value: parseFloat(negative_mark_value) || 0,
          is_published: is_published === 'true' || is_published === true,
          allow_anytime: allowAnytimeFlag,
          exam_type: exam_type || 'mock_test',
          show_in_mock_tests: show_in_mock_tests === 'true' || show_in_mock_tests === true,
          logo_url: logoUrl,
          thumbnail_url: thumbnailUrl,
          slug: examSlug,
          url_path: urlPath,
          syllabus: parsedSyllabus,
          is_test_series: is_test_series === 'true' || is_test_series === true,
          test_series_id: test_series_id || null,
          test_series_section_id: test_series_section_id || null,
          test_series_topic_id: test_series_topic_id || null,
          exam_date: toDateOrNull(exam_date),
          display_order: display_order ? parseInt(display_order) : 0,
          paper_section_id: paper_section_id || null,
          paper_topic_id: paper_topic_id || null,
          exam_uid: examUid
        }
      });
    } catch (error) {
      logger.error('Create exam error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to create exam'
      });
    }

    if (parsedSyllabus?.length) {
      try {
        await prisma.exam_syllabus.createMany({ data: parsedSyllabus.map(topic => ({ exam_id: exam.id, topic })) });
      } catch (syllabusError) {
        logger.error('Insert syllabus error:', syllabusError);
      }
    }

    // New exam_date may introduce a new year into the filter.
    await bustExamListCaches();

    res.status(201).json({
      success: true,
      message: 'Exam created successfully',
      data: exam
    });
  } catch (error) {
    logger.error('Create exam error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating exam'
    });
  }
};

const updateExam = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    console.log('Update exam - received data:', updateData);
    console.log('Paper section ID:', updateData.paper_section_id);
    console.log('Paper topic ID:', updateData.paper_topic_id);

    const existingExam = await prisma.exams.findUnique({ where: { id }, select: { logo_url: true, thumbnail_url: true } }).catch(() => null);

    if (req.files) {
      if (req.files.logo) {
        if (existingExam?.logo_url) {
          const oldKey = extractKeyFromUrl(existingExam.logo_url);
          if (oldKey) await deleteFile(oldKey);
        }
        const logoResult = await uploadExamLogo(req.files.logo[0]);
        updateData.logo_url = logoResult.url;
      }
      if (req.files.thumbnail) {
        if (existingExam?.thumbnail_url) {
          const oldKey = extractKeyFromUrl(existingExam.thumbnail_url);
          if (oldKey) await deleteFile(oldKey);
        }
        const thumbnailResult = await uploadExamThumbnail(req.files.thumbnail[0]);
        updateData.thumbnail_url = thumbnailResult.url;
      }
    }

    if (updateData.duration) updateData.duration = parseInt(updateData.duration);
    if (updateData.total_marks) updateData.total_marks = parseInt(updateData.total_marks);
    if (updateData.total_questions) updateData.total_questions = parseInt(updateData.total_questions);
    if (updateData.pass_percentage) updateData.pass_percentage = parseFloat(updateData.pass_percentage);
    if (updateData.negative_mark_value) updateData.negative_mark_value = parseFloat(updateData.negative_mark_value);
    if (updateData.is_free !== undefined) updateData.is_free = updateData.is_free === 'true' || updateData.is_free === true;
    if (updateData.negative_marking !== undefined) updateData.negative_marking = updateData.negative_marking === 'true' || updateData.negative_marking === true;
    if (updateData.is_published !== undefined) updateData.is_published = updateData.is_published === 'true' || updateData.is_published === true;
    if (updateData.allow_anytime !== undefined) updateData.allow_anytime = updateData.allow_anytime === 'true' || updateData.allow_anytime === true;
    if (updateData.allow_anytime) {
      updateData.status = 'anytime';
      updateData.start_date = null;
      updateData.end_date = null;
    } else {
      if (updateData.start_date !== undefined) updateData.start_date = toDateOrNull(updateData.start_date);
      if (updateData.end_date !== undefined) updateData.end_date = toDateOrNull(updateData.end_date);
    }
    if (updateData.show_in_mock_tests !== undefined) updateData.show_in_mock_tests = updateData.show_in_mock_tests === 'true' || updateData.show_in_mock_tests === true;
    if (updateData.is_current_affair !== undefined) updateData.is_current_affair = updateData.is_current_affair === 'true' || updateData.is_current_affair === true;
    // is_premium is a Boolean column that this endpoint receives via multipart
    // form-data (like every other field here, since req.files is checked above) —
    // meaning it can arrive as the literal string "true"/"false". supabase-js/PostgREST
    // let Postgres implicitly cast a text 'true'/'false' to boolean; Prisma's client
    // validates types before the query is built and rejects a string for a Boolean
    // field outright. The original createExam/bulkCreateExamWithContent already
    // explicitly coerce this field — updateExam was missing the same coercion, which
    // would have made Prisma throw on a legitimate admin update. Added here as a type
    // adaptation for the stricter client, not a business-logic change.
    if (updateData.is_premium !== undefined) updateData.is_premium = updateData.is_premium === 'true' || updateData.is_premium === true;
    if (updateData.is_test_series !== undefined) {
      updateData.is_test_series = updateData.is_test_series === 'true' || updateData.is_test_series === true;
      if (!updateData.is_test_series) {
        updateData.test_series_id = null;
        updateData.test_series_section_id = null;
        updateData.test_series_topic_id = null;
      }
    }
    if (updateData.test_series_id !== undefined) updateData.test_series_id = updateData.test_series_id || null;
    if (updateData.test_series_section_id !== undefined) updateData.test_series_section_id = updateData.test_series_section_id || null;
    if (updateData.test_series_topic_id !== undefined) updateData.test_series_topic_id = updateData.test_series_topic_id || null;
    if (updateData.exam_date !== undefined) updateData.exam_date = toDateOrNull(updateData.exam_date);
    if (updateData.display_order !== undefined) updateData.display_order = parseInt(updateData.display_order) || 0;
    if (updateData.paper_section_id !== undefined) updateData.paper_section_id = updateData.paper_section_id || null;
    if (updateData.paper_topic_id !== undefined) updateData.paper_topic_id = updateData.paper_topic_id || null;
    let parsedSyllabus = undefined;
    if (updateData.syllabus) {
      if (typeof updateData.syllabus === 'string') {
        parsedSyllabus = JSON.parse(updateData.syllabus);
      } else if (Array.isArray(updateData.syllabus)) {
        parsedSyllabus = updateData.syllabus;
      }
      updateData.syllabus = parsedSyllabus || [];
    }

    let exam;
    try {
      exam = await prisma.exams.update({ where: { id }, data: updateData });
    } catch (error) {
      logger.error('Update exam error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update exam'
      });
    }

    if (parsedSyllabus !== undefined) {
      try {
        await prisma.exam_syllabus.deleteMany({ where: { exam_id: id } });
        if (parsedSyllabus.length) {
          await prisma.exam_syllabus.createMany({ data: parsedSyllabus.map(topic => ({ exam_id: id, topic })) });
        }
      } catch (syllabusSyncError) {
        logger.error('Sync syllabus error:', syllabusSyncError);
      }
    }

    // Auto-sync current_affairs_quizzes when is_current_affair changes on a short_quiz
    if (updateData.is_current_affair !== undefined && exam.exam_type === 'short_quiz') {
      if (updateData.is_current_affair) {
        // Upsert into current_affairs_quizzes (unique constraint on exam_id handles duplicates)
        try {
          await prisma.current_affairs_quizzes.upsert({
            where: { exam_id: id },
            create: { exam_id: id, is_published: true },
            update: { is_published: true }
          });
        } catch (caError) {
          logger.error('Auto-link current affairs quiz error:', caError);
        }
      } else {
        // Remove from current_affairs_quizzes
        try {
          await prisma.current_affairs_quizzes.deleteMany({ where: { exam_id: id } });
        } catch (caError) {
          logger.error('Auto-unlink current affairs quiz error:', caError);
        }
      }
    }

    // exam_date may have changed — refresh listings + year filter.
    await bustExamListCaches();

    res.json({
      success: true,
      message: 'Exam updated successfully',
      data: exam
    });
  } catch (error) {
    logger.error('Update exam error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating exam'
    });
  }
};

const deleteExam = async (req, res) => {
  try {
    const { id } = req.params;

    const exam = await prisma.exams.findUnique({ where: { id }, select: { id: true, logo_url: true, thumbnail_url: true } }).catch(() => null);

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    // Collect related questions and options to clean up images and records
    const questions = await prisma.questions.findMany({ where: { exam_id: id }, select: { id: true, image_url: true } });

    const questionIds = questions?.map(q => q.id) || [];

    let options = [];
    if (questionIds.length) {
      options = await prisma.question_options.findMany({
        where: { question_id: { in: questionIds } },
        select: { id: true, question_id: true, image_url: true }
      });
    }

    // Delete option images
    for (const option of options) {
      if (option.image_url) {
        const optionKey = extractKeyFromUrl(option.image_url);
        if (optionKey) {
          try {
            await deleteFile(optionKey);
          } catch (fileError) {
            logger.warn('Failed to delete option image:', fileError);
          }
        }
      }
    }

    // Delete question images
    for (const question of questions || []) {
      if (question.image_url) {
        const questionKey = extractKeyFromUrl(question.image_url);
        if (questionKey) {
          try {
            await deleteFile(questionKey);
          } catch (fileError) {
            logger.warn('Failed to delete question image:', fileError);
          }
        }
      }
    }

    // Delete options and questions from DB
    if (questionIds.length) {
      try {
        await prisma.question_options.deleteMany({ where: { question_id: { in: questionIds } } });
      } catch (error) {
        logger.error('Delete options error:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to delete related options'
        });
      }

      try {
        await prisma.questions.deleteMany({ where: { exam_id: id } });
      } catch (error) {
        logger.error('Delete questions error:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to delete related questions'
        });
      }
    }

    // Delete sections and syllabus rows
    await prisma.exam_sections.deleteMany({ where: { exam_id: id } });
    await prisma.exam_syllabus.deleteMany({ where: { exam_id: id } });

    // Delete exam media
    if (exam.logo_url) {
      const logoKey = extractKeyFromUrl(exam.logo_url);
      if (logoKey) {
        try {
          await deleteFile(logoKey);
        } catch (fileError) {
          logger.warn('Failed to delete logo image:', fileError);
        }
      }
    }
    if (exam.thumbnail_url) {
      const thumbnailKey = extractKeyFromUrl(exam.thumbnail_url);
      if (thumbnailKey) {
        try {
          await deleteFile(thumbnailKey);
        } catch (fileError) {
          logger.warn('Failed to delete thumbnail image:', fileError);
        }
      }
    }

    try {
      await prisma.exams.delete({ where: { id } });
    } catch (error) {
      logger.error('Delete exam error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete exam'
      });
    }

    // Refresh listings + year filter so a now-empty year drops out immediately.
    await bustExamListCaches();

    res.json({
      success: true,
      message: 'Exam and related content deleted successfully'
    });
  } catch (error) {
    logger.error('Delete exam error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting exam'
    });
  }
};

// Remove a year from the exam-page filter.
//
// There is no "years" table — the filter is derived from published exams' exam_date
// (see examController.getExamYears). So a year can only be removed once no published
// exam falls within it. This endpoint:
//   • 400 if the year param is invalid
//   • 409 if published exams still use that year (returns how many)
//   • 200 + busts the derived-years cache otherwise, so the filter refreshes at once
//     (covers the common case where the year lingered only because of a stale cache).
const deleteExamYear = async (req, res) => {
  try {
    const year = parseInt(req.params.year, 10);
    if (!Number.isInteger(year) || year < 1900 || year > 3000) {
      return res.status(400).json({ success: false, message: 'Invalid year' });
    }

    const start = new Date(`${year}-01-01`);
    const end = new Date(`${year + 1}-01-01`);

    // Mirror the exact filters getExamYears() uses, so this reflects what the UI shows.
    let count;
    try {
      count = await prisma.exams.count({
        where: { exam_date: { gte: start, lt: end }, is_published: true, deleted_at: null }
      });
    } catch (error) {
      logger.error('deleteExamYear count error:', error);
      return res.status(500).json({ success: false, message: 'Failed to verify exams for the year' });
    }

    if ((count || 0) > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot remove ${year}: ${count} published exam(s) still use this year. Change their exam date or delete them first.`,
        exam_count: count,
      });
    }

    // No exams in this year → refresh the derived years + exam listings cache.
    await bustExamListCaches();

    return res.json({
      success: true,
      message: `Year ${year} removed from the exam filter.`,
    });
  } catch (error) {
    logger.error('deleteExamYear error:', error);
    return res.status(500).json({ success: false, message: 'Server error while removing the year' });
  }
};

const createSection = async (req, res) => {
  try {
    const { exam_id, name, total_questions, marks_per_question, duration, section_order } = req.body;

    let section;
    try {
      section = await prisma.exam_sections.create({
        data: {
          exam_id,
          name,
          total_questions: parseInt(total_questions),
          marks_per_question: parseFloat(marks_per_question),
          duration: duration ? parseInt(duration) : null,
          section_order: parseInt(section_order)
        }
      });
    } catch (error) {
      logger.error('Create section error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to create section'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Section created successfully',
      data: section
    });
  } catch (error) {
    logger.error('Create section error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating section'
    });
  }
};

const updateSection = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    if (updateData.total_questions) updateData.total_questions = parseInt(updateData.total_questions);
    if (updateData.marks_per_question) updateData.marks_per_question = parseFloat(updateData.marks_per_question);
    if (updateData.duration) updateData.duration = parseInt(updateData.duration);
    if (updateData.section_order) updateData.section_order = parseInt(updateData.section_order);

    // Fetch existing section to detect name change
    const existingSection = await prisma.exam_sections.findUnique({ where: { id }, select: { name: true, exam_id: true } }).catch(() => null);

    let section;
    try {
      section = await prisma.exam_sections.update({ where: { id }, data: updateData });
    } catch (error) {
      logger.error('Update section error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update section'
      });
    }

    // Bust translation cache if section name changed
    const nameChanged = updateData.name && updateData.name !== existingSection?.name;
    if (nameChanged && existingSection?.exam_id) {
      await bustExamTranslationCache(existingSection.exam_id);
    }

    res.json({
      success: true,
      message: 'Section updated successfully',
      data: section
    });
  } catch (error) {
    logger.error('Update section error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating section'
    });
  }
};

const deleteSection = async (req, res) => {
  try {
    const { id } = req.params;

    try {
      await prisma.exam_sections.delete({ where: { id } });
    } catch (error) {
      logger.error('Delete section error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete section'
      });
    }

    res.json({
      success: true,
      message: 'Section deleted successfully'
    });
  } catch (error) {
    logger.error('Delete section error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting section'
    });
  }
};

const createQuestion = async (req, res) => {
  try {
    const { exam_id, section_id, passage_id, type, text, marks, negative_marks, explanation, explanation_image_url, difficulty, question_order, question_number } = req.body;

    let imageUrl = null;
    if (req.file) {
      const imageResult = await uploadQuestionImage(req.file);
      imageUrl = imageResult.url;
    }

    let question;
    try {
      question = await prisma.questions.create({
        data: {
          exam_id,
          section_id,
          passage_id: passage_id || null,
          type,
          text,
          marks: parseFloat(marks),
          negative_marks: parseFloat(negative_marks) || 0,
          explanation,
          explanation_image_url,
          image_url: imageUrl,
          difficulty,
          question_order: question_order ? parseInt(question_order) : null,
          question_number: question_number ? parseInt(question_number) : null
        }
      });
    } catch (error) {
      logger.error('Create question error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to create question'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Question created successfully',
      data: question
    });
  } catch (error) {
    logger.error('Create question error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating question'
    });
  }
};

const updateQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    const existingQuestion = await prisma.questions.findUnique({ where: { id }, select: { image_url: true, text: true, exam_id: true } }).catch(() => null);

    if (req.file) {
      if (existingQuestion?.image_url) {
        const oldKey = extractKeyFromUrl(existingQuestion.image_url);
        if (oldKey) await deleteFile(oldKey);
      }
      const imageResult = await uploadQuestionImage(req.file);
      updateData.image_url = imageResult.url;
    }

    if (updateData.marks) updateData.marks = parseFloat(updateData.marks);
    if (updateData.negative_marks) updateData.negative_marks = parseFloat(updateData.negative_marks);
    if (updateData.question_order) updateData.question_order = parseInt(updateData.question_order);
    if (updateData.question_number) updateData.question_number = parseInt(updateData.question_number);
    if ('passage_id' in updateData) updateData.passage_id = updateData.passage_id || null;

    let question;
    try {
      question = await prisma.questions.update({ where: { id }, data: updateData });
    } catch (error) {
      logger.error('Update question error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update question'
      });
    }

    // Bust translation cache if the English text changed
    const textChanged = updateData.text && updateData.text !== existingQuestion?.text;
    if (textChanged && existingQuestion?.exam_id) {
      await bustExamTranslationCache(existingQuestion.exam_id);
    }

    res.json({
      success: true,
      message: 'Question updated successfully',
      data: question
    });
  } catch (error) {
    logger.error('Update question error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating question'
    });
  }
};

const deleteQuestion = async (req, res) => {
  try {
    const { id } = req.params;

    const question = await prisma.questions.findUnique({ where: { id }, select: { image_url: true } }).catch(() => null);

    if (question?.image_url) {
      const imageKey = extractKeyFromUrl(question.image_url);
      if (imageKey) await deleteFile(imageKey);
    }

    try {
      await prisma.questions.delete({ where: { id } });
    } catch (error) {
      logger.error('Delete question error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete question'
      });
    }

    res.json({
      success: true,
      message: 'Question deleted successfully'
    });
  } catch (error) {
    logger.error('Delete question error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting question'
    });
  }
};

const createOption = async (req, res) => {
  try {
    const { question_id, option_text, is_correct, option_order } = req.body;

    let imageUrl = null;
    if (req.file) {
      const imageResult = await uploadOptionImage(req.file);
      imageUrl = imageResult.url;
    }

    let option;
    try {
      option = await prisma.question_options.create({
        data: {
          question_id,
          option_text,
          is_correct: is_correct === 'true' || is_correct === true,
          option_order: parseInt(option_order),
          image_url: imageUrl
        }
      });
    } catch (error) {
      logger.error('Create option error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to create option'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Option created successfully',
      data: option
    });
  } catch (error) {
    logger.error('Create option error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating option'
    });
  }
};

const updateOption = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    const existingOption = await prisma.question_options.findUnique({
      where: { id },
      select: { image_url: true, option_text: true, question_id: true, questions: { select: { exam_id: true } } }
    }).catch(() => null);

    if (req.file) {
      if (existingOption?.image_url) {
        const oldKey = extractKeyFromUrl(existingOption.image_url);
        if (oldKey) await deleteFile(oldKey);
      }
      const imageResult = await uploadOptionImage(req.file);
      updateData.image_url = imageResult.url;
    }

    if (updateData.is_correct !== undefined) {
      updateData.is_correct = updateData.is_correct === 'true' || updateData.is_correct === true;
    }

    if (updateData.option_order) {
      updateData.option_order = parseInt(updateData.option_order);
    }

    let option;
    try {
      option = await prisma.question_options.update({ where: { id }, data: updateData });
    } catch (error) {
      logger.error('Update option error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update option'
      });
    }

    // Bust translation cache if the English option text changed
    const optionTextChanged = updateData.option_text && updateData.option_text !== existingOption?.option_text;
    if (optionTextChanged) {
      const examId = existingOption?.questions?.exam_id;
      if (examId) await bustExamTranslationCache(examId);
    }

    res.json({
      success: true,
      message: 'Option updated successfully',
      data: option
    });
  } catch (error) {
    logger.error('Update option error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating option'
    });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', role = '' } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }
    if (role) where.role = role;

    let users, count;
    try {
      [users, count] = await Promise.all([
        prisma.users.findMany({
          where,
          select: { id: true, email: true, name: true, phone: true, avatar_url: true, role: true, is_verified: true, is_blocked: true, block_reason: true, created_at: true },
          orderBy: { created_at: 'desc' },
          skip: offset,
          take: parseInt(limit)
        }),
        prisma.users.count({ where })
      ]);
    } catch (error) {
      logger.error('Get users error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch users'
      });
    }

    res.json({
      success: true,
      data: users,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    logger.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching users'
    });
  }
};

const updateUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const allowedRoles = ['user', 'admin', 'editor', 'author'];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be one of "user", "admin", "editor", or "author"'
      });
    }

    const currentUser = await prisma.users.findUnique({ where: { id }, select: { id: true, email: true, name: true, role: true } }).catch(() => null);

    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const oldRole = currentUser.role;

    let user;
    try {
      user = await prisma.users.update({ where: { id }, data: { role }, select: { id: true, email: true, name: true, role: true } });
    } catch (error) {
      logger.error('Update user role error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update user role'
      });
    }

    try {
      const elevatedRoles = ['admin', 'editor', 'author'];
      if (elevatedRoles.includes(role)) {
        const adminRole = await prisma.admin_roles.findUnique({ where: { name: role }, select: { id: true } });

        if (!adminRole) {
          throw new Error(`${role} role not found`);
        }

        await prisma.admin_users.upsert({
          where: { user_id: id },
          create: { user_id: id, role_id: adminRole.id, is_active: true },
          update: { role_id: adminRole.id, is_active: true }
        });
      } else {
        await prisma.admin_users.deleteMany({ where: { user_id: id } });
      }
    } catch (adminSyncError) {
      logger.error('Sync admin_users error:', adminSyncError);
      return res.status(500).json({
        success: false,
        message: 'User role updated, but failed to synchronize admin access'
      });
    }

    try {
      await sendRoleChangedEmail(user.email, user.name, {
        oldRole,
        newRole: role,
        changedBy: req.user?.name || req.user?.email || 'a platform administrator'
      });
    } catch (emailError) {
      logger.warn('Failed to send role change email (non-critical):', emailError);
    }

    res.json({
      success: true,
      message: 'User role updated successfully',
      data: user
    });
  } catch (error) {
    logger.error('Update user role error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating user role'
    });
  }
};

const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, bio, is_verified, is_blocked, block_reason } = req.body;

    const existing = await prisma.users.findUnique({ where: { id }, select: { id: true, email: true, name: true } }).catch(() => null);

    if (!existing) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (bio !== undefined) updateData.bio = bio;
    if (is_verified !== undefined) updateData.is_verified = Boolean(is_verified);
    if (is_blocked !== undefined) {
      updateData.is_blocked = Boolean(is_blocked);
      updateData.block_reason = is_blocked ? (block_reason || null) : null;
    }

    let user;
    try {
      user = await prisma.users.update({
        where: { id },
        data: updateData,
        select: {
          id: true, email: true, name: true, phone: true, bio: true, role: true, is_verified: true, is_blocked: true,
          block_reason: true, avatar_url: true, auth_provider: true, is_onboarded: true, is_premium: true,
          subscription_plan_id: true, subscription_expires_at: true, subscription_auto_renew: true, created_at: true
        }
      });
    } catch (error) {
      logger.error('Admin updateUser error:', error);
      return res.status(500).json({ success: false, message: 'Failed to update user' });
    }

    res.json({ success: true, message: 'User updated successfully', data: user });
  } catch (error) {
    logger.error('Admin updateUser error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating user' });
  }
};

const adminUpdateUserSubscription = async (req, res) => {
  try {
    const { id } = req.params;
    const { plan_id, expires_at, is_premium, auto_renew, send_notification } = req.body;

    const user = await prisma.users.findUnique({ where: { id }, select: { id: true, email: true, name: true } }).catch(() => null);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const updateData = {};
    if (plan_id !== undefined) updateData.subscription_plan_id = plan_id || null;
    if (expires_at !== undefined) updateData.subscription_expires_at = expires_at ? new Date(expires_at) : null;
    if (is_premium !== undefined) updateData.is_premium = Boolean(is_premium);
    if (auto_renew !== undefined) updateData.subscription_auto_renew = Boolean(auto_renew);

    try {
      await prisma.users.update({ where: { id }, data: updateData });
    } catch (error) {
      logger.error('Admin update subscription error:', error);
      return res.status(500).json({ success: false, message: 'Failed to update subscription' });
    }

    if (send_notification && plan_id) {
      try {
        const plan = await prisma.subscription_plans.findUnique({
          where: { id: plan_id },
          select: { id: true, name: true, duration_days: true, normal_price_cents: true, currency_code: true }
        });

        if (plan) {
          await sendSubscriptionActivatedEmail(user.email, user.name, {
            planName: plan.name,
            amount: 0,
            currency: plan.currency_code || 'INR',
            expiresAt: expires_at || new Date(Date.now() + plan.duration_days * 86400000).toISOString(),
            autoRenew: Boolean(auto_renew)
          });
        }
      } catch (emailError) {
        logger.warn('Failed to send subscription notification email (non-critical):', emailError);
      }
    }

    res.json({ success: true, message: 'Subscription updated successfully' });
  } catch (error) {
    logger.error('Admin update subscription error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating subscription' });
  }
};

const adminRestoreUser = async (req, res) => {
  try {
    const { id } = req.params;

    try {
      await prisma.users.update({ where: { id }, data: { deleted_at: null } });
    } catch (error) {
      logger.error('Admin restore user error:', error);
      return res.status(500).json({ success: false, message: 'Failed to restore user' });
    }

    res.json({ success: true, message: 'User account restored successfully' });
  } catch (error) {
    logger.error('Admin restore user error:', error);
    res.status(500).json({ success: false, message: 'Server error while restoring user' });
  }
};

const adminDeleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    try {
      await prisma.users.update({ where: { id }, data: { deleted_at: new Date() } });
    } catch (error) {
      logger.error('Admin delete user error:', error);
      return res.status(500).json({ success: false, message: 'Failed to delete user' });
    }

    res.json({ success: true, message: 'User account deleted successfully' });
  } catch (error) {
    logger.error('Admin delete user error:', error);
    res.status(500).json({ success: false, message: 'Server error while deleting user' });
  }
};

const toggleUserBlock = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    const currentUser = await prisma.users.findUnique({ where: { id }, select: { is_blocked: true } }).catch(() => null);

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const nextStatus = !currentUser.is_blocked;

    if (nextStatus && (!reason || !reason.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Block reason is required when blocking a user'
      });
    }

    let user;
    try {
      user = await prisma.users.update({
        where: { id },
        data: {
          is_blocked: nextStatus,
          block_reason: nextStatus ? reason.trim() : null
        },
        select: { id: true, email: true, name: true, is_blocked: true, block_reason: true }
      });
    } catch (error) {
      logger.error('Toggle user block error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update user status'
      });
    }

    res.json({
      success: true,
      message: `User ${user.is_blocked ? 'blocked' : 'unblocked'} successfully`,
      data: user
    });
  } catch (error) {
    logger.error('Toggle user block error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating user status'
    });
  }
};

const saveDraftExam = async (req, res) => {
  try {
    let examPayload;

    try {
      examPayload = typeof req.body.exam === 'string' ? JSON.parse(req.body.exam) : req.body.exam;
    } catch (parseError) {
      logger.error('Failed to parse exam payload for save draft:', parseError);
      return res.status(400).json({
        success: false,
        message: 'Invalid exam payload. Ensure exam data is valid JSON.'
      });
    }

    if (!examPayload) {
      return res.status(400).json({
        success: false,
        message: 'Exam data is required.'
      });
    }

    examPayload.is_published = false;
    req.body.exam = JSON.stringify(examPayload);

    return bulkCreateExamWithContent(req, res);
  } catch (error) {
    logger.error('Save draft exam error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while saving draft exam'
    });
  }
};

const bulkCreateExamWithContent = async (req, res) => {
  try {
    const {
      exam: rawExam,
      sections: rawSections
    } = req.body;

    let exam;
    let sections = [];

    try {
      exam = typeof rawExam === 'string' ? JSON.parse(rawExam) : rawExam;
    } catch (parseError) {
      logger.error('Failed to parse exam payload for bulk create:', parseError);
      return res.status(400).json({
        success: false,
        message: 'Invalid exam payload. Ensure exam data is valid JSON.'
      });
    }

    console.log('Bulk create - received exam data:', exam);
    console.log('Paper section ID:', exam.paper_section_id);
    console.log('Paper topic ID:', exam.paper_topic_id);

    try {
      if (rawSections) {
        sections = typeof rawSections === 'string' ? JSON.parse(rawSections) : rawSections;
      }
      if (!Array.isArray(sections)) {
        sections = [];
      }
    } catch (parseError) {
      logger.error('Failed to parse sections payload for bulk create:', parseError);
      return res.status(400).json({
        success: false,
        message: 'Invalid sections payload. Ensure sections data is valid JSON.'
      });
    }

    if (!exam) {
      return res.status(400).json({
        success: false,
        message: 'Exam data is required.'
      });
    }

    // Parallelize: file uploads + slug generation + category/subcategory lookups
    const [logoResult, thumbnailResult, examSlug, catResult, subcatResult] = await Promise.all([
      req.files?.logo ? uploadExamLogo(req.files.logo[0]) : Promise.resolve(null),
      req.files?.thumbnail ? uploadExamThumbnail(req.files.thumbnail[0]) : Promise.resolve(null),
      ensureUniqueSlug(prisma.exams, slugify(exam.slug || exam.title)),
      exam.category_id
        ? prisma.exam_categories.findUnique({ where: { id: exam.category_id }, select: { slug: true } })
        : Promise.resolve(null),
      exam.subcategory_id
        ? prisma.exam_subcategories.findUnique({ where: { id: exam.subcategory_id }, select: { slug: true } })
        : Promise.resolve(null)
    ]);

    const logoUrl = logoResult?.url || null;
    const thumbnailUrl = thumbnailResult?.url || null;
    const categorySlug = catResult?.slug || exam.category || '';
    const subcategorySlug = subcatResult?.slug || exam.subcategory || '';
    const parentSlug = subcategorySlug || categorySlug;
    const urlPath = parentSlug ? `/${parentSlug}/${examSlug}` : `/${examSlug}`;

    const parsedSyllabus = exam.syllabus || [];
    const supportsHindi = sections.some(s =>
      s.name_hi || s.questions?.some(q => q.text_hi || q.explanation_hi || q.options?.some(o => o.option_text_hi))
    ) || false;

    const allowAnytimeFlag = exam.allow_anytime === 'true' || exam.allow_anytime === true;
    const normalizedStatus = allowAnytimeFlag ? 'anytime' : (exam.status || 'upcoming');
    const normalizedStartDate = allowAnytimeFlag ? null : toDateOrNull(exam.start_date);
    const normalizedEndDate = allowAnytimeFlag ? null : toDateOrNull(exam.end_date);

    // Generate unique exam_uid in BHMK######X format
    const bulkExamUid = await generateUniqueExamUid();

    let createdExam;
    try {
      createdExam = await prisma.exams.create({
        data: {
          title: exam.title,
          duration: parseInt(exam.duration),
          total_marks: parseInt(exam.total_marks),
          total_questions: parseInt(exam.total_questions),
          instructions: exam.instructions?.trim() ? exam.instructions : null,
          category: exam.category || categorySlug,
          category_id: exam.category_id || null,
          subcategory: exam.subcategory || subcategorySlug,
          subcategory_id: exam.subcategory_id || null,
          difficulty: exam.difficulty || null,
          difficulty_id: exam.difficulty_id || null,
          status: normalizedStatus,
          start_date: normalizedStartDate,
          end_date: normalizedEndDate,
          pass_percentage: parseFloat(exam.pass_percentage),
          is_free: exam.is_free === 'true' || exam.is_free === true,
          negative_marking: exam.negative_marking === 'true' || exam.negative_marking === true,
          negative_mark_value: parseFloat(exam.negative_mark_value) || 0,
          is_published: exam.is_published === 'true' || exam.is_published === true,
          allow_anytime: allowAnytimeFlag,
          exam_type: exam.exam_type || 'mock_test',
          show_in_mock_tests: exam.show_in_mock_tests === 'true' || exam.show_in_mock_tests === true,
          is_premium: exam.is_premium === 'true' || exam.is_premium === true,
          supports_hindi: supportsHindi,
          logo_url: logoUrl,
          thumbnail_url: thumbnailUrl,
          slug: examSlug,
          url_path: urlPath,
          syllabus: parsedSyllabus,
          is_test_series: exam.is_test_series === 'true' || exam.is_test_series === true,
          test_series_id: exam.test_series_id || null,
          test_series_section_id: exam.test_series_section_id || null,
          test_series_topic_id: exam.test_series_topic_id || null,
          exam_date: toDateOrNull(exam.exam_date),
          display_order: exam.display_order ? parseInt(exam.display_order) || 0 : 0,
          paper_section_id: exam.paper_section_id || null,
          paper_topic_id: exam.paper_topic_id || null,
          is_current_affair: exam.exam_type === 'short_quiz' ? (exam.is_current_affair === 'true' || exam.is_current_affair === true) : false,
          exam_uid: bulkExamUid
        }
      });
    } catch (examError) {
      logger.error('Bulk create exam error:', examError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create exam'
      });
    }

    // Insert syllabus in background (don't block response for it)
    const syllabusPromise = parsedSyllabus?.length
      ? prisma.exam_syllabus.createMany({ data: parsedSyllabus.map(topic => ({ exam_id: createdExam.id, topic })) })
      : Promise.resolve();

    // Batch insert all sections at once
    let createdSections = [];
    if (sections.length > 0) {
      const sectionInserts = sections.map((section, idx) => ({
        exam_id: createdExam.id,
        name: section.name,
        name_hi: section.name_hi || null,
        total_questions: section.total_questions,
        marks_per_question: section.marks_per_question,
        duration: section.duration || null,
        section_order: section.section_order ?? (idx + 1)
      }));

      try {
        createdSections = await prisma.exam_sections.createManyAndReturn({ data: sectionInserts });
      } catch (sectionError) {
        logger.error('Bulk create sections error:', sectionError);
      }

      // Chunked insert: questions then options (prevents row-count-per-request truncation)
      if (createdSections.length > 0) {
        const allQuestionInserts = [];
        const questionSectionMap = [];

        // Build a name-based lookup so section order mismatches don't lose questions
        const sectionByName = new Map();
        createdSections.forEach(s => sectionByName.set(s.name, s));

        for (let i = 0; i < sections.length; i++) {
          const section = sections[i];
          const createdSection = createdSections[i] || sectionByName.get(section.name);
          if (!createdSection || !section.questions?.length) continue;

          for (let qIdx = 0; qIdx < section.questions.length; qIdx++) {
            const question = section.questions[qIdx];
            questionSectionMap.push({ question });
            allQuestionInserts.push({
              exam_id: createdExam.id,
              section_id: createdSection.id,
              passage_id: question.passage_id || null,
              type: question.type,
              text: question.text,
              text_hi: question.text_hi || null,
              marks: question.marks,
              negative_marks: question.negative_marks,
              explanation: question.explanation || null,
              explanation_hi: question.explanation_hi || null,
              explanation_image_url: question.explanation_image_url || null,
              difficulty: question.difficulty,
              image_url: question.image_url || null,
              question_order: question.question_order || (qIdx + 1),
              question_number: question.question_number || (qIdx + 1)
            });
          }
        }

        logger.info(`Bulk create: inserting ${allQuestionInserts.length} questions in chunks of ${QUESTION_BATCH_SIZE}`);

        const createdQuestions = await batchInsert(prisma.questions, allQuestionInserts, { id: true }, QUESTION_BATCH_SIZE);

        logger.info(`Bulk create: ${createdQuestions.length}/${allQuestionInserts.length} questions inserted`);

        let questionIdMap = [];

        if (createdQuestions.length > 0) {
          const allOptionInserts = [];
          // See updateExamWithContent for why this uses precomputed [start, count] ranges
          // instead of findIndex + slice/filter — that was O(n) per option lookup (each call
          // allocating a new array), making the mapping step O(n^3) overall.
          const questionOptionRanges = new Array(createdQuestions.length);
          for (let qi = 0; qi < createdQuestions.length; qi++) {
            const { question } = questionSectionMap[qi];
            const start = allOptionInserts.length;
            if (question.options?.length) {
              for (const option of question.options) {
                allOptionInserts.push({
                  question_id: createdQuestions[qi].id,
                  option_text: option.option_text,
                  option_text_hi: option.option_text_hi || null,
                  is_correct: option.is_correct === true || option.is_correct === 'true',
                  option_order: option.option_order,
                  image_url: option.image_url || null
                });
              }
            }
            questionOptionRanges[qi] = { start, count: question.options?.length || 0 };
          }

          logger.info(`Bulk create: inserting ${allOptionInserts.length} options in chunks of ${OPTION_BATCH_SIZE}`);

          const createdOptions = await batchInsert(prisma.question_options, allOptionInserts, { id: true }, OPTION_BATCH_SIZE);

          // Build question and option ID mappings
          for (let qi = 0; qi < createdQuestions.length; qi++) {
            const { question } = questionSectionMap[qi];
            const questionMapping = {
              oldId: question.id,
              newId: createdQuestions[qi].id,
              hasImage: !!question.image_url,
              options: []
            };

            const { start, count } = questionOptionRanges[qi];
            for (let oi = 0; oi < count; oi++) {
              const createdOption = createdOptions[start + oi];
              if (createdOption) {
                questionMapping.options.push({
                  oldId: question.options[oi].id,
                  newId: createdOption.id,
                  hasImage: !!question.options[oi].image_url
                });
              }
            }
            questionIdMap.push(questionMapping);
          }
        }

        // Store questionIdMap at exam level for easy access
        if (questionIdMap.length > 0) {
          createdExam.questionIdMap = questionIdMap;
        }
      }
    }

    await syllabusPromise;

    // Verify actual inserted counts from DB
    const dbQuestionCount = await prisma.questions.count({ where: { exam_id: createdExam.id } });

    const expectedQuestions = sections.reduce((sum, s) => sum + (s.questions?.length || 0), 0);

    if (dbQuestionCount !== expectedQuestions) {
      logger.error(`Bulk create verification FAILED: expected ${expectedQuestions} questions, DB has ${dbQuestionCount} for exam ${createdExam.id}`);
    } else {
      logger.info(`Bulk create verification OK: ${dbQuestionCount}/${expectedQuestions} questions for exam ${createdExam.id}`);
    }

    res.status(201).json({
      success: true,
      message: 'Exam created successfully with all content',
      data: {
        exam: createdExam,
        sections: createdSections,
        questionCount: dbQuestionCount,
        expectedQuestionCount: expectedQuestions,
        questionIdMap: createdExam.questionIdMap || []
      }
    });
  } catch (error) {
    logger.error('Bulk create exam with content error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating exam with content'
    });
  }
};

const updateExamWithContent = async (req, res) => {
  try {
    const { id } = req.params;
    const { exam: rawExam, sections: rawSections } = req.body;

    const existingExam = await prisma.exams.findUnique({ where: { id }, select: { id: true, logo_url: true, thumbnail_url: true } }).catch(() => null);

    if (!existingExam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    let examPayload;
    let sectionsPayload = [];

    try {
      examPayload = typeof rawExam === 'string' ? JSON.parse(rawExam) : rawExam;
    } catch (parseError) {
      logger.error('Failed to parse exam payload for update:', parseError);
      return res.status(400).json({
        success: false,
        message: 'Invalid exam payload. Ensure exam data is valid JSON.'
      });
    }

    try {
      if (rawSections) {
        sectionsPayload = typeof rawSections === 'string' ? JSON.parse(rawSections) : rawSections;
      }
      if (!Array.isArray(sectionsPayload)) {
        sectionsPayload = [];
      }
    } catch (parseError) {
      logger.error('Failed to parse sections payload for update:', parseError);
      return res.status(400).json({
        success: false,
        message: 'Invalid sections payload. Ensure sections data is valid JSON.'
      });
    }

    const bool = (value) => value === true || value === 'true';
    const numberOrNull = (value, fallback = null) => {
      if (value === undefined || value === null || value === '') return fallback;
      const parsed = Number(value);
      return Number.isNaN(parsed) ? fallback : parsed;
    };

    // Parallelize: file uploads + slug generation + category/subcategory lookups
    const uploadPromises = [];

    if (req.files?.logo?.[0]) {
      if (existingExam.logo_url) {
        const oldLogoKey = extractKeyFromUrl(existingExam.logo_url);
        if (oldLogoKey) deleteFile(oldLogoKey).catch(() => {});
      }
      uploadPromises.push(uploadExamLogo(req.files.logo[0]));
    } else {
      uploadPromises.push(Promise.resolve(null));
    }

    if (req.files?.thumbnail?.[0]) {
      if (existingExam.thumbnail_url) {
        const oldThumbKey = extractKeyFromUrl(existingExam.thumbnail_url);
        if (oldThumbKey) deleteFile(oldThumbKey).catch(() => {});
      }
      uploadPromises.push(uploadExamThumbnail(req.files.thumbnail[0]));
    } else {
      uploadPromises.push(Promise.resolve(null));
    }

    const baseSlug = slugify(examPayload.slug || examPayload.title || 'exam');

    const [logoResult, thumbnailResult, examSlug, catResult, subcatResult] = await Promise.all([
      ...uploadPromises,
      ensureUniqueSlug(prisma.exams, baseSlug, { excludeId: id }),
      examPayload.category_id
        ? prisma.exam_categories.findUnique({ where: { id: examPayload.category_id }, select: { slug: true } })
        : Promise.resolve(null),
      examPayload.subcategory_id
        ? prisma.exam_subcategories.findUnique({ where: { id: examPayload.subcategory_id }, select: { slug: true } })
        : Promise.resolve(null)
    ]);

    const logoUrl = logoResult?.url || existingExam.logo_url || null;
    const thumbnailUrl = thumbnailResult?.url || existingExam.thumbnail_url || null;
    const categorySlug = catResult?.slug || examPayload.category || '';
    const subcategorySlug = subcatResult?.slug || examPayload.subcategory || '';
    const parentSlug = subcategorySlug || categorySlug;
    const urlPath = parentSlug ? `/${parentSlug}/${examSlug}` : `/${examSlug}`;

    let parsedSyllabus = [];
    if (Array.isArray(examPayload.syllabus)) {
      parsedSyllabus = examPayload.syllabus;
    } else if (typeof examPayload.syllabus === 'string') {
      try {
        parsedSyllabus = JSON.parse(examPayload.syllabus);
      } catch (e) {
        parsedSyllabus = [];
      }
    }

    const allowAnytimeFlag = bool(examPayload.allow_anytime);
    const isTestSeriesFlag = bool(examPayload.is_test_series);
    const normalizedStatus = allowAnytimeFlag ? 'anytime' : (examPayload.status || 'upcoming');
    const normalizedStartDate = allowAnytimeFlag ? null : toDateOrNull(examPayload.start_date);
    const normalizedEndDate = allowAnytimeFlag ? null : toDateOrNull(examPayload.end_date);
    const supportsHindi = sectionsPayload.some(section =>
      section.name_hi || section.questions?.some(q => q.text_hi || q.explanation_hi || q.options?.some(o => o.option_text_hi))
    );

    const normalizedTestSeriesId = isTestSeriesFlag ? (examPayload.test_series_id || null) : null;
    const normalizedTestSeriesSectionId = isTestSeriesFlag ? (examPayload.test_series_section_id || null) : null;
    const normalizedTestSeriesTopicId = isTestSeriesFlag ? (examPayload.test_series_topic_id || null) : null;

    const updatePayload = {
      title: examPayload.title,
      duration: numberOrNull(examPayload.duration, 0),
      total_marks: numberOrNull(examPayload.total_marks, 0),
      total_questions: numberOrNull(examPayload.total_questions, 0),
      // Empty string is normalised to null so "cleared" means "fall back to the
      // default instructions" rather than rendering a blank instructions block.
      instructions: examPayload.instructions?.trim() ? examPayload.instructions : null,
      category: examPayload.category || categorySlug,
      category_id: examPayload.category_id || null,
      subcategory: examPayload.subcategory || subcategorySlug,
      subcategory_id: examPayload.subcategory_id || null,
      difficulty: examPayload.difficulty || null,
      difficulty_id: examPayload.difficulty_id || null,
      status: normalizedStatus,
      start_date: normalizedStartDate,
      end_date: normalizedEndDate,
      pass_percentage: numberOrNull(examPayload.pass_percentage, 0),
      is_free: bool(examPayload.is_free),
      negative_marking: bool(examPayload.negative_marking),
      negative_mark_value: numberOrNull(examPayload.negative_mark_value, 0),
      is_published: bool(examPayload.is_published),
      allow_anytime: allowAnytimeFlag,
      exam_type: examPayload.exam_type || 'mock_test',
      show_in_mock_tests: bool(examPayload.show_in_mock_tests),
      is_premium: bool(examPayload.is_premium),
      supports_hindi: supportsHindi,
      logo_url: logoUrl,
      thumbnail_url: thumbnailUrl,
      slug: examSlug,
      url_path: urlPath,
      syllabus: parsedSyllabus,
      is_test_series: isTestSeriesFlag,
      test_series_id: normalizedTestSeriesId,
      test_series_section_id: normalizedTestSeriesSectionId,
      test_series_topic_id: normalizedTestSeriesTopicId,
      exam_date: toDateOrNull(examPayload.exam_date),
      display_order: numberOrNull(examPayload.display_order, 0),
      paper_section_id: examPayload.paper_section_id || null,
      paper_topic_id: examPayload.paper_topic_id || null,
      is_current_affair: examPayload.exam_type === 'short_quiz' ? bool(examPayload.is_current_affair) : false
    };

    console.log('Update exam with content - paper_section_id:', examPayload.paper_section_id);
    console.log('Update exam with content - paper_topic_id:', examPayload.paper_topic_id);

    // NOTE: these writes must stay sequential. Each Prisma call runs as its own implicit
    // transaction on a separate pool connection, so running them concurrently deadlocked
    // (40P01): exam_syllabus.deleteMany takes a FK KEY SHARE lock on the parent exams row
    // while exams.update wants that same row exclusively. Locking the exams row first gives
    // every transaction the same lock order, so concurrent PUTs queue instead of cycling.
    // The questions read takes no conflicting locks and can stay parallel with the update.
    let updatedExam;
    let existingQuestions;
    try {
      [updatedExam, existingQuestions] = await Promise.all([
        prisma.exams.update({ where: { id }, data: updatePayload }),
        prisma.questions.findMany({ where: { exam_id: id }, select: { id: true } })
      ]);
      await prisma.exam_syllabus.deleteMany({ where: { exam_id: id } });
    } catch (updateError) {
      logger.error('Update exam with content error:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update exam'
      });
    }

    // Parallelize: insert new syllabus + delete old options
    const deleteContentPromises = [];

    if (existingQuestions?.length) {
      const questionIds = existingQuestions.map(q => q.id);
      deleteContentPromises.push(
        prisma.question_options.deleteMany({ where: { question_id: { in: questionIds } } })
      );
    }

    if (parsedSyllabus.length) {
      deleteContentPromises.push(
        prisma.exam_syllabus.createMany({ data: parsedSyllabus.map(topic => ({ exam_id: id, topic })) })
      );
    }

    await Promise.all(deleteContentPromises);

    // Now delete questions and sections (must be after options are deleted).
    // Sequential for the same reason as above: deleting a question takes a FK lock on its
    // parent exam_sections row, which exam_sections.deleteMany wants exclusively.
    await prisma.questions.deleteMany({ where: { exam_id: id } });
    await prisma.exam_sections.deleteMany({ where: { exam_id: id } });

    // Batch insert all sections at once
    let createdSections = [];

    if (sectionsPayload.length > 0) {
      const sectionInserts = sectionsPayload.map((section, idx) => ({
        exam_id: id,
        name: section.name || '',
        name_hi: section.name_hi || null,
        total_questions: numberOrNull(section.total_questions, section.questions?.length || 0),
        marks_per_question: numberOrNull(section.marks_per_question, 1),
        duration: numberOrNull(section.duration),
        section_order: numberOrNull(section.section_order, idx + 1)
      }));

      try {
        createdSections = await prisma.exam_sections.createManyAndReturn({ data: sectionInserts });
      } catch (sectionError) {
        logger.error('Update exam sections batch insert error:', sectionError);
      }

      // Chunked insert: questions then options (prevents row-count-per-request truncation)
      if (createdSections.length > 0) {
        const allQuestionInserts = [];
        const questionSectionMap = [];

        // Build a name-based lookup so section order mismatches don't lose questions
        const sectionByName = new Map();
        createdSections.forEach(s => sectionByName.set(s.name, s));

        for (let i = 0; i < sectionsPayload.length; i++) {
          const section = sectionsPayload[i];
          const createdSection = createdSections[i] || sectionByName.get(section.name);
          if (!createdSection || !section.questions?.length) continue;

          for (let qIdx = 0; qIdx < section.questions.length; qIdx++) {
            const question = section.questions[qIdx];
            questionSectionMap.push({ question });
            allQuestionInserts.push({
              exam_id: id,
              section_id: createdSection.id,
              passage_id: question.passage_id || null,
              type: question.type,
              text: question.text,
              text_hi: question.text_hi || null,
              marks: numberOrNull(question.marks, 0),
              negative_marks: numberOrNull(question.negative_marks, 0),
              explanation: question.explanation || null,
              explanation_hi: question.explanation_hi || null,
              explanation_image_url: question.explanation_image_url || null,
              difficulty: question.difficulty,
              image_url: question.image_url || null,
              question_order: question.question_order || (qIdx + 1),
              question_number: question.question_number || (qIdx + 1)
            });
          }
        }

        logger.info(`Update exam: inserting ${allQuestionInserts.length} questions in chunks of ${QUESTION_BATCH_SIZE}`);

        const createdQuestions = await batchInsert(prisma.questions, allQuestionInserts, { id: true }, QUESTION_BATCH_SIZE);

        logger.info(`Update exam: ${createdQuestions.length}/${allQuestionInserts.length} questions inserted`);

        let questionIdMap = [];

        if (createdQuestions.length > 0) {
          const allOptionInserts = [];
          // Track each question's option range as a plain [start, count] pair rather than
          // re-deriving it later via findIndex — that previous approach was O(n) per option
          // lookup (with an inner slice+filter allocation on every call), making the overall
          // mapping step O(n^3) for exams with many questions/options. This is O(n) instead.
          const questionOptionRanges = new Array(createdQuestions.length);
          for (let qi = 0; qi < createdQuestions.length; qi++) {
            const { question } = questionSectionMap[qi];
            const start = allOptionInserts.length;
            if (question.options?.length) {
              for (const option of question.options) {
                allOptionInserts.push({
                  question_id: createdQuestions[qi].id,
                  option_text: option.option_text,
                  option_text_hi: option.option_text_hi || null,
                  is_correct: bool(option.is_correct),
                  option_order: numberOrNull(option.option_order),
                  image_url: option.image_url || null
                });
              }
            }
            questionOptionRanges[qi] = { start, count: question.options?.length || 0 };
          }

          logger.info(`Update exam: inserting ${allOptionInserts.length} options in chunks of ${OPTION_BATCH_SIZE}`);

          const createdOptions = await batchInsert(prisma.question_options, allOptionInserts, { id: true }, OPTION_BATCH_SIZE);

          // Build question and option ID mappings
          for (let qi = 0; qi < createdQuestions.length; qi++) {
            const { question } = questionSectionMap[qi];
            const questionMapping = {
              oldId: question.id,
              newId: createdQuestions[qi].id,
              hasImage: !!question.image_url,
              options: []
            };

            // Map options for this question using its precomputed range
            const { start, count } = questionOptionRanges[qi];
            for (let oi = 0; oi < count; oi++) {
              const createdOption = createdOptions[start + oi];
              if (createdOption) {
                questionMapping.options.push({
                  oldId: question.options[oi].id,
                  newId: createdOption.id,
                  hasImage: !!question.options[oi].image_url
                });
              }
            }
            questionIdMap.push(questionMapping);
          }
        }

        // Store questionIdMap at exam level for easy access
        if (questionIdMap.length > 0) {
          updatedExam.questionIdMap = questionIdMap;
        }
      }
    }

    // Verify actual inserted counts from DB
    const dbQuestionCount = await prisma.questions.count({ where: { exam_id: id } });

    const expectedQuestions = sectionsPayload.reduce((sum, s) => sum + (s.questions?.length || 0), 0);

    if (dbQuestionCount !== expectedQuestions) {
      logger.error(`Update exam verification FAILED: expected ${expectedQuestions} questions, DB has ${dbQuestionCount} for exam ${id}`);
    } else {
      logger.info(`Update exam verification OK: ${dbQuestionCount}/${expectedQuestions} questions for exam ${id}`);
    }

    // Auto-sync current_affairs_quizzes when is_current_affair changes on a short_quiz
    if (updatePayload.exam_type === 'short_quiz') {
      if (updatePayload.is_current_affair) {
        try {
          await prisma.current_affairs_quizzes.upsert({
            where: { exam_id: id },
            create: { exam_id: id, is_published: true },
            update: { is_published: true }
          });
        } catch (caError) {
          logger.error('Auto-link current affairs quiz error (updateExamWithContent):', caError);
        }
      } else {
        try {
          await prisma.current_affairs_quizzes.deleteMany({ where: { exam_id: id } });
        } catch (caError) {
          logger.error('Auto-unlink current affairs quiz error (updateExamWithContent):', caError);
        }
      }
    }

    // exam_date may have changed — refresh listings + year filter.
    await bustExamListCaches();

    res.json({
      success: true,
      message: 'Exam updated successfully with all content',
      data: {
        exam: updatedExam,
        sections: createdSections,
        questionCount: dbQuestionCount,
        expectedQuestionCount: expectedQuestions,
        questionIdMap: updatedExam.questionIdMap || []
      }
    });
  } catch (error) {
    logger.error('Update exam with content error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating exam with content'
    });
  }
};

// Immediate image upload for questions
const uploadQuestionImageController = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    // Validate question ID format
    if (!id || id.startsWith('question-') || id.startsWith('temp-')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid question ID. Please save the question first before uploading images.'
      });
    }

    // Check if question exists
    const question = await prisma.questions.findUnique({ where: { id }, select: { id: true, image_url: true } }).catch((error) => {
      logger.error('Question not found for image upload:', { id, error });
      return null;
    });

    if (!question) {
      return res.status(404).json({
        success: false,
        message: 'Question not found. Please save the question first before uploading images.'
      });
    }

    // Delete old image if exists
    if (question.image_url) {
      const oldImageKey = extractKeyFromUrl(question.image_url);
      if (oldImageKey) {
        try {
          await deleteFile(oldImageKey);
        } catch (deleteError) {
          logger.warn('Failed to delete old question image:', deleteError);
        }
      }
    }

    // Upload new image
    const imageResult = await uploadQuestionImage(req.file);

    // Update question with new image URL
    try {
      await prisma.questions.update({ where: { id }, data: { image_url: imageResult.url } });
    } catch (updateError) {
      logger.error('Failed to update question image URL:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update question image'
      });
    }

    res.json({
      success: true,
      message: 'Question image uploaded successfully',
      data: {
        image_url: imageResult.url
      }
    });
  } catch (error) {
    logger.error('Upload question image error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while uploading question image'
    });
  }
};

// Remove question image
const removeQuestionImage = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate question ID format
    if (!id || id.startsWith('question-') || id.startsWith('temp-')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid question ID. Please save the question first.'
      });
    }

    // Get current question
    const question = await prisma.questions.findUnique({ where: { id }, select: { id: true, image_url: true } }).catch((error) => {
      logger.error('Question not found for image removal:', { id, error });
      return null;
    });

    if (!question) {
      return res.status(404).json({
        success: false,
        message: 'Question not found. The question may have been deleted or not saved yet.'
      });
    }

    // Delete image from Cloudflare if exists
    if (question.image_url) {
      const imageKey = extractKeyFromUrl(question.image_url);
      if (imageKey) {
        try {
          await deleteFile(imageKey);
        } catch (deleteError) {
          logger.warn('Failed to delete question image from Cloudflare:', deleteError);
        }
      }
    }

    // Update question to remove image URL
    try {
      await prisma.questions.update({ where: { id }, data: { image_url: null } });
    } catch (updateError) {
      logger.error('Failed to remove question image URL:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to remove question image'
      });
    }

    res.json({
      success: true,
      message: 'Question image removed successfully'
    });
  } catch (error) {
    logger.error('Remove question image error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while removing question image'
    });
  }
};

// Immediate image upload for options
const uploadOptionImageController = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    // Validate option ID format
    if (!id || id.startsWith('opt-') || id.startsWith('temp-')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid option ID. Please save the option first before uploading images.'
      });
    }

    // Check if option exists
    const option = await prisma.question_options.findUnique({ where: { id }, select: { id: true, image_url: true } }).catch((error) => {
      logger.error('Option not found for image upload:', { id, error });
      return null;
    });

    if (!option) {
      return res.status(404).json({
        success: false,
        message: 'Option not found. Please save the option first before uploading images.'
      });
    }

    // Delete old image if exists
    if (option.image_url) {
      const oldImageKey = extractKeyFromUrl(option.image_url);
      if (oldImageKey) {
        try {
          await deleteFile(oldImageKey);
        } catch (deleteError) {
          logger.warn('Failed to delete old option image:', deleteError);
        }
      }
    }

    // Upload new image
    const imageResult = await uploadOptionImage(req.file);

    // Update option with new image URL
    try {
      await prisma.question_options.update({ where: { id }, data: { image_url: imageResult.url } });
    } catch (updateError) {
      logger.error('Failed to update option image URL:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update option image'
      });
    }

    res.json({
      success: true,
      message: 'Option image uploaded successfully',
      data: {
        image_url: imageResult.url
      }
    });
  } catch (error) {
    logger.error('Upload option image error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while uploading option image'
    });
  }
};

// Remove option image
const removeOptionImage = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate option ID format
    if (!id || id.startsWith('opt-') || id.startsWith('temp-')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid option ID. Please save the option first.'
      });
    }

    // Get current option
    const option = await prisma.question_options.findUnique({ where: { id }, select: { id: true, image_url: true } }).catch((error) => {
      logger.error('Option not found for image removal:', { id, error });
      return null;
    });

    if (!option) {
      return res.status(404).json({
        success: false,
        message: 'Option not found. The option may have been deleted or not saved yet.'
      });
    }

    // Delete image from Cloudflare if exists
    if (option.image_url) {
      const imageKey = extractKeyFromUrl(option.image_url);
      if (imageKey) {
        try {
          await deleteFile(imageKey);
        } catch (deleteError) {
          logger.warn('Failed to delete option image from Cloudflare:', deleteError);
        }
      }
    }

    // Update option to remove image URL
    try {
      await prisma.question_options.update({ where: { id }, data: { image_url: null } });
    } catch (updateError) {
      logger.error('Failed to remove option image URL:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to remove option image'
      });
    }

    res.json({
      success: true,
      message: 'Option image removed successfully'
    });
  } catch (error) {
    logger.error('Remove option image error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while removing option image'
    });
  }
};

// Upload explanation image (for rich text editor)
const uploadExplanationImageController = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    // Upload image to R2
    const imageResult = await uploadExplanationImage(req.file);

    res.json({
      success: true,
      message: 'Explanation image uploaded successfully',
      data: {
        image_url: imageResult.url
      }
    });
  } catch (error) {
    logger.error('Upload explanation image error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while uploading explanation image'
    });
  }
};

// Upload English PDF for exam
const uploadExamPdfEnController = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No PDF file provided'
      });
    }

    // Check if exam exists and get title
    const exam = await prisma.exams.findUnique({ where: { id }, select: { id: true, title: true, pdf_url_en: true } }).catch((error) => {
      logger.error('Exam not found for PDF upload:', { id, error });
      return null;
    });

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    // Delete old PDF if exists
    if (exam.pdf_url_en) {
      const oldPdfKey = extractKeyFromUrl(exam.pdf_url_en);
      if (oldPdfKey) {
        try {
          await deleteFile(oldPdfKey);
        } catch (deleteError) {
          logger.warn('Failed to delete old English PDF:', deleteError);
        }
      }
    }

    // Upload new PDF with exam title as filename
    const pdfResult = await uploadExamPdfEn(req.file, exam.title);

    // Update exam with new PDF URL
    try {
      await prisma.exams.update({ where: { id }, data: { pdf_url_en: pdfResult.url } });
    } catch (updateError) {
      logger.error('Failed to update exam English PDF URL:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update exam PDF'
      });
    }

    res.json({
      success: true,
      message: 'English PDF uploaded successfully',
      data: {
        pdf_url_en: pdfResult.url
      }
    });
  } catch (error) {
    logger.error('Upload exam English PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while uploading PDF'
    });
  }
};

// Upload Hindi PDF for exam
const uploadExamPdfHiController = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No PDF file provided'
      });
    }

    // Check if exam exists and get title
    const exam = await prisma.exams.findUnique({ where: { id }, select: { id: true, title: true, pdf_url_hi: true } }).catch((error) => {
      logger.error('Exam not found for PDF upload:', { id, error });
      return null;
    });

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    // Delete old PDF if exists
    if (exam.pdf_url_hi) {
      const oldPdfKey = extractKeyFromUrl(exam.pdf_url_hi);
      if (oldPdfKey) {
        try {
          await deleteFile(oldPdfKey);
        } catch (deleteError) {
          logger.warn('Failed to delete old Hindi PDF:', deleteError);
        }
      }
    }

    // Upload new PDF with exam title as filename
    const pdfResult = await uploadExamPdfHi(req.file, exam.title);

    // Update exam with new PDF URL
    try {
      await prisma.exams.update({ where: { id }, data: { pdf_url_hi: pdfResult.url } });
    } catch (updateError) {
      logger.error('Failed to update exam Hindi PDF URL:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update exam PDF'
      });
    }

    res.json({
      success: true,
      message: 'Hindi PDF uploaded successfully',
      data: {
        pdf_url_hi: pdfResult.url
      }
    });
  } catch (error) {
    logger.error('Upload exam Hindi PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while uploading PDF'
    });
  }
};

// Remove English PDF from exam
const removeExamPdfEn = async (req, res) => {
  try {
    const { id } = req.params;

    // Get current exam
    const exam = await prisma.exams.findUnique({ where: { id }, select: { id: true, pdf_url_en: true } }).catch((error) => {
      logger.error('Exam not found for PDF removal:', { id, error });
      return null;
    });

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    // Delete PDF from storage if exists
    if (exam.pdf_url_en) {
      const pdfKey = extractKeyFromUrl(exam.pdf_url_en);
      if (pdfKey) {
        try {
          await deleteFile(pdfKey);
        } catch (deleteError) {
          logger.warn('Failed to delete English PDF from storage:', deleteError);
        }
      }
    }

    // Update exam to remove PDF URL
    try {
      await prisma.exams.update({ where: { id }, data: { pdf_url_en: null } });
    } catch (updateError) {
      logger.error('Failed to remove exam English PDF URL:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to remove exam PDF'
      });
    }

    res.json({
      success: true,
      message: 'English PDF removed successfully'
    });
  } catch (error) {
    logger.error('Remove exam English PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while removing PDF'
    });
  }
};

// Remove Hindi PDF from exam
const removeExamPdfHi = async (req, res) => {
  try {
    const { id } = req.params;

    // Get current exam
    const exam = await prisma.exams.findUnique({ where: { id }, select: { id: true, pdf_url_hi: true } }).catch((error) => {
      logger.error('Exam not found for PDF removal:', { id, error });
      return null;
    });

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    // Delete PDF from storage if exists
    if (exam.pdf_url_hi) {
      const pdfKey = extractKeyFromUrl(exam.pdf_url_hi);
      if (pdfKey) {
        try {
          await deleteFile(pdfKey);
        } catch (deleteError) {
          logger.warn('Failed to delete Hindi PDF from storage:', deleteError);
        }
      }
    }

    // Update exam to remove PDF URL
    try {
      await prisma.exams.update({ where: { id }, data: { pdf_url_hi: null } });
    } catch (updateError) {
      logger.error('Failed to remove exam Hindi PDF URL:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to remove exam PDF'
      });
    }

    res.json({
      success: true,
      message: 'Hindi PDF removed successfully'
    });
  } catch (error) {
    logger.error('Remove exam Hindi PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while removing PDF'
    });
  }
};

module.exports = {
  getAdminExams,
  getAdminExamById,
  getExamSectionsWithQuestions,
  createExam,
  updateExam,
  deleteExam,
  deleteExamYear,
  createSection,
  updateSection,
  deleteSection,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  createOption,
  updateOption,
  bulkCreateExamWithContent,
  updateExamWithContent,
  generateExamPdf,
  saveDraftExam,
  uploadQuestionImage: uploadQuestionImageController,
  removeQuestionImage,
  uploadOptionImage: uploadOptionImageController,
  removeOptionImage,
  uploadExplanationImage: uploadExplanationImageController,
  uploadExamPdfEn: uploadExamPdfEnController,
  uploadExamPdfHi: uploadExamPdfHiController,
  removeExamPdfEn,
  removeExamPdfHi,
  getUserDetails,
  getAllUsers,
  updateUserRole,
  toggleUserBlock,
  updateUser,
  adminUpdateUserSubscription,
  adminDeleteUser,
  adminRestoreUser
};
