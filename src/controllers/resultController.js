const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { evaluateExam } = require('./examController');

// score/total_marks/percentage/accuracy are Decimal columns — Prisma returns Decimal.js
// objects, which JSON-serialize to strings, not numbers (unlike supabase-js, which
// always returned these as plain numeric strings the frontend's `Number()`/arithmetic
// coerced transparently). Every result/section-analysis row read from the DB must be
// normalized before going into a res.json() response, or frontend code calling
// `.toFixed()` on these fields throws (see MIGRATION_TRACKER §4.5).
const normalizeResultDecimals = (result) => {
  if (!result) return result;
  if (result.score !== undefined) result.score = Number(result.score);
  if (result.total_marks !== undefined) result.total_marks = Number(result.total_marks);
  if (result.percentage !== undefined) result.percentage = Number(result.percentage);
  return result;
};

const resultDetailSelect = {
  id: true, user_id: true, score: true, total_marks: true, percentage: true,
  correct_answers: true, wrong_answers: true, unattempted: true, time_taken: true,
  rank: true, total_participants: true, status: true, created_at: true,
  attempt_id: true, exam_id: true,
  exam_attempts: { select: { language: true } },
  exams: {
    select: {
      id: true, title: true, category: true, difficulty: true, image_url: true,
      pass_percentage: true, total_questions: true, duration: true, slug: true, url_path: true,
    },
  },
};

const enrichResultComparisons = async (result) => {
  let examResults;
  try {
    examResults = await prisma.results.findMany({
      where: { exam_id: result.exam_id, is_published: true },
      select: { id: true, score: true },
    });
  } catch (error) {
    logger.warn('Failed to fetch exam comparison stats:', error, { examId: result.exam_id, resultId: result.id });
    return {
      averageScore: null,
      bestScore: null,
      computedRank: null,
      computedTotalParticipants: null,
      percentileAchieved: null,
      questionsAttempted: (result.correct_answers || 0) + (result.wrong_answers || 0),
      accuracyAchieved: (result.correct_answers || 0) + (result.wrong_answers || 0) > 0
        ? Number((((result.correct_answers || 0) / ((result.correct_answers || 0) + (result.wrong_answers || 0))) * 100).toFixed(2))
        : 0,
    };
  }

  const scores = (examResults || []).map(entry => Number(entry.score) || 0);
  const averageScore = scores.length
    ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(2))
    : null;
  const bestScore = scores.length ? Math.max(...scores) : null;
  const computedTotalParticipants = examResults?.length || null;
  const currentScore = Number(result.score) || 0;
  const computedRank = computedTotalParticipants
    ? examResults.filter(entry => (Number(entry.score) || 0) > currentScore).length + 1
    : null;
  const effectiveRank = result.rank || computedRank;
  const effectiveTotalParticipants = result.total_participants || computedTotalParticipants;
  const percentileAchieved = effectiveRank && effectiveTotalParticipants
    ? Number((((effectiveTotalParticipants - effectiveRank + 1) / effectiveTotalParticipants) * 100).toFixed(2))
    : null;

  return {
    averageScore,
    bestScore,
    computedRank,
    computedTotalParticipants,
    percentileAchieved,
    questionsAttempted: (result.correct_answers || 0) + (result.wrong_answers || 0),
    accuracyAchieved: (result.correct_answers || 0) + (result.wrong_answers || 0) > 0
      ? Number((((result.correct_answers || 0) / ((result.correct_answers || 0) + (result.wrong_answers || 0))) * 100).toFixed(2))
      : 0,
  };
};

// Faithful equivalent of the old `exam_attempts!inner(...)` embed — since results.attempt_id
// is nullable, an inner join excluded any orphaned result with no attempt row at all.
const fetchResultWithDetails = (filters = {}) => {
  const where = {
    is_published: true,
    user_id: filters.userId,
    attempt_id: { not: null },
  };

  if (filters.id) where.id = filters.id;
  if (filters.attemptId) where.attempt_id = filters.attemptId;

  return prisma.results.findFirst({ where, select: resultDetailSelect }).then(normalizeResultDecimals);
};

const ensureResultForAttempt = async (attemptId, userId) => {
  try {
    const existingResult = await fetchResultWithDetails({ attemptId, userId });
    if (existingResult) {
      return { result: existingResult };
    }

    const attempt = await prisma.exam_attempts.findUnique({
      where: { id: attemptId },
      select: { id: true, exam_id: true, user_id: true, is_submitted: true },
    });

    if (!attempt || attempt.user_id !== userId) {
      return { status: 404, message: 'Exam attempt not found' };
    }

    if (!attempt.is_submitted) {
      return { status: 400, message: 'Exam has not been submitted yet' };
    }

    await evaluateExam(attemptId, attempt.exam_id, userId);

    const regeneratedResult = await fetchResultWithDetails({ attemptId, userId });

    if (!regeneratedResult) {
      return { status: 404, message: 'Result not found' };
    }

    return { result: regeneratedResult };
  } catch (error) {
    logger.error('ensureResultForAttempt error:', error);
    return { status: 500, message: 'Failed to fetch result details' };
  }
};

const getResults = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const where = { user_id: req.user.id, is_published: true, attempt_id: { not: null } };

    let results, count;
    try {
      [results, count] = await Promise.all([
        prisma.results.findMany({
          where,
          select: {
            id: true, attempt_id: true, score: true, total_marks: true, percentage: true,
            correct_answers: true, wrong_answers: true, unattempted: true, time_taken: true,
            rank: true, total_participants: true, status: true, created_at: true,
            exam_attempts: { select: { language: true } },
            exams: { select: { id: true, title: true, category: true, image_url: true } },
          },
          orderBy: { created_at: 'desc' },
          skip: offset,
          take: parseInt(limit),
        }),
        prisma.results.count({ where }),
      ]);
    } catch (error) {
      logger.error('Get results error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch results'
      });
    }

    const formattedResults = results.map(r => ({
      ...normalizeResultDecimals(r),
      language: r.exam_attempts?.language || 'en',
      examTitle: r.exams?.title
    }));

    res.json({
      success: true,
      data: formattedResults,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    logger.error('Get results error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch results'
    });
  }
};

const getUserStats = async (req, res) => {
  try {
    let results;
    try {
      results = await prisma.results.findMany({
        where: { user_id: req.user.id, is_published: true },
        select: { percentage: true, created_at: true },
        orderBy: { created_at: 'asc' },
      });
    } catch (error) {
      logger.error('Get user stats error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch stats'
      });
    }

    const examsTaken = results.length;

    const daysActive = results.reduce((set, result) => {
      if (result.created_at) {
        set.add(new Date(result.created_at).toDateString());
      }
      return set;
    }, new Set()).size;

    // percentage is a Decimal column — Prisma returns Decimal.js objects, not plain
    // numbers, so this must convert with Number() before summing (see MIGRATION_TRACKER
    // §4.5 for the general gotcha; supabase-js returned this as a string, which the
    // original `|| 0` coercion happened to tolerate differently than a Decimal object would).
    const avgScore = examsTaken > 0
      ? parseFloat((results.reduce((sum, result) => sum + (Number(result.percentage) || 0), 0) / examsTaken).toFixed(1))
      : 0;

    res.json({
      success: true,
      data: {
        examsTaken,
        daysActive,
        avgScore
      }
    });
  } catch (error) {
    logger.error('Get user stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch stats'
    });
  }
};

// Robustly load section-wise analysis for a result. Previously this relied solely on a
// PostgREST FK embed whose error was silently discarded — any embed/resolution hiccup
// made the whole section breakdown vanish ("Section-wise analysis is not available").
// Here we fetch the rows first (keyed by the real result id) and resolve section names
// in a second query, so the breakdown shows whenever rows exist.
const loadSectionWiseAnalysis = async (resultId, attemptLanguage = 'en') => {
  if (!resultId) return [];

  let rows;
  try {
    rows = await prisma.section_analysis.findMany({
      where: { result_id: resultId },
      select: { id: true, section_id: true, score: true, total_marks: true, correct_answers: true, wrong_answers: true, unattempted: true, accuracy: true, time_taken: true },
    });
  } catch (error) {
    logger.error('Failed to load section_analysis:', error, { resultId });
    return [];
  }
  if (!rows || rows.length === 0) return [];

  const sectionIds = [...new Set(rows.map(r => r.section_id).filter(Boolean))];
  const sectionById = new Map();
  if (sectionIds.length > 0) {
    const sections = await prisma.exam_sections.findMany({
      where: { id: { in: sectionIds } },
      select: { id: true, name: true, name_hi: true },
    });
    (sections || []).forEach(s => sectionById.set(s.id, s));
  }

  return rows.map(r => {
    const section = sectionById.get(r.section_id);
    const sectionName = attemptLanguage === 'hi' && section?.name_hi
      ? section.name_hi
      : (section?.name || 'Section');
    return {
      sectionId: r.section_id,
      sectionName,
      score: r.score,
      totalMarks: r.total_marks,
      correctAnswers: r.correct_answers,
      wrongAnswers: r.wrong_answers,
      unattempted: r.unattempted,
      accuracy: r.accuracy,
      timeTaken: r.time_taken,
    };
  });
};

const getResultByAttemptId = async (req, res) => {
  try {
    const { attemptId } = req.params;

    const { result, status, message } = await ensureResultForAttempt(attemptId, req.user.id);

    if (!result) {
      return res.status(status || 404).json({
        success: false,
        message: message || 'Result not found'
      });
    }

    const attemptLanguage = result.exam_attempts?.language || 'en';

    result.sectionWiseAnalysis = await loadSectionWiseAnalysis(result.id, attemptLanguage);

    result.exam = {
      ...result.exams,
      id: result.exams.id,
      title: result.exams.title,
      pass_percentage: result.exams.pass_percentage,
      total_questions: result.exams.total_questions
    };
    result.comparison = await enrichResultComparisons(result);
    if (!result.rank && result.comparison?.computedRank) {
      result.rank = result.comparison.computedRank;
    }
    if (!result.total_participants && result.comparison?.computedTotalParticipants) {
      result.total_participants = result.comparison.computedTotalParticipants;
    }
    result.language = attemptLanguage;
    delete result.exams;
    delete result.exam_attempts;

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Get result by attempt ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch result details'
    });
  }
};

const getResultById = async (req, res) => {
  try {
    const { id } = req.params;

    const resultByIdSelect = {
      id: true, score: true, total_marks: true, percentage: true, correct_answers: true,
      wrong_answers: true, unattempted: true, time_taken: true, rank: true, total_participants: true,
      status: true, created_at: true, attempt_id: true, exam_id: true,
      exams: { select: { id: true, title: true, category: true, difficulty: true, image_url: true, pass_percentage: true, total_questions: true } },
    };

    let result = await prisma.results.findFirst({
      where: { user_id: req.user.id, id },
      select: resultByIdSelect,
    });

    if (!result) {
      result = await prisma.results.findFirst({
        where: { user_id: req.user.id, attempt_id: id },
        select: resultByIdSelect,
      });
    }

    if (!result) {
      const ensured = await ensureResultForAttempt(id, req.user.id);

      if (!ensured.result) {
        return res.status(ensured.status || 404).json({
          success: false,
          message: ensured.message || 'Result not found'
        });
      }

      result = ensured.result;
    }

    // Use the resolved result.id (the URL param may be an attempt id) and the resilient
    // loader so the breakdown is keyed correctly and never crashes on a missing embed.
    result.sectionWiseAnalysis = await loadSectionWiseAnalysis(
      result.id,
      result.exam_attempts?.language || result.language || 'en'
    );

    result.comparison = await enrichResultComparisons(result);
    if (!result.rank && result.comparison?.computedRank) {
      result.rank = result.comparison.computedRank;
    }
    if (!result.total_participants && result.comparison?.computedTotalParticipants) {
      result.total_participants = result.comparison.computedTotalParticipants;
    }

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Get result by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch result details'
    });
  }
};

const getAnswerReview = async (req, res) => {
  try {
    const { resultId } = req.params;

    const result = await prisma.results.findFirst({
      where: { id: resultId, user_id: req.user.id, attempt_id: { not: null } },
      select: {
        attempt_id: true, exam_id: true, user_id: true,
        exam_attempts: { select: { language: true } },
      },
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Result not found'
      });
    }

    const attemptLanguage = result.exam_attempts?.language || 'en';

    // NOTE: exam_sections has no `language` column in the live schema — same as the
    // note in examController.js. Querying the real columns directly is behaviorally
    // identical to the fallback path that always actually ran.
    const sectionsData = await prisma.exam_sections.findMany({
      where: { exam_id: result.exam_id },
      select: { id: true, name: true, name_hi: true, total_questions: true, marks_per_question: true, duration: true, section_order: true },
    });

    const sections = (sectionsData || []).map(section => ({
      ...section,
      language: section.language || attemptLanguage
    }));

    const allowedSectionIds = new Set(
      sections
        .filter(section => (section.language || attemptLanguage) === attemptLanguage)
        .map(section => section.id)
    );

    const questionHasContent = (question, language) => {
      if (language === 'hi') {
        return Boolean(
          (question.text_hi && question.text_hi.trim()) ||
          (question.explanation_hi && question.explanation_hi.trim()) ||
          (question.question_options && question.question_options.some(opt => opt.option_text_hi && opt.option_text_hi.trim()))
        );
      }
      return Boolean(
        (question.text && question.text.trim()) ||
        (question.explanation && question.explanation.trim()) ||
        (question.question_options && question.question_options.some(opt => opt.option_text && opt.option_text.trim()))
      );
    };

    const questions = await prisma.questions.findMany({
      where: { exam_id: result.exam_id, section_id: { not: null } },
      select: {
        id: true, section_id: true, passage_id: true, type: true, text: true, text_hi: true, marks: true, negative_marks: true,
        explanation: true, explanation_hi: true, explanation_image_url: true, image_url: true, question_order: true, question_number: true,
        exam_sections: { select: { id: true, name: true, name_hi: true, section_order: true } },
        question_options: { select: { id: true, option_text: true, option_text_hi: true, is_correct: true, option_order: true, image_url: true } },
        passages: { select: { id: true, title: true, content: true, content_hi: true } },
      },
      orderBy: { question_number: 'asc' },
    });

    const filteredQuestions = questions.filter(q =>
      allowedSectionIds.has(q.section_id) && questionHasContent(q, attemptLanguage)
    );

    const userAnswers = await prisma.user_answers.findMany({
      where: { attempt_id: result.attempt_id },
      select: { question_id: true, answer: true, is_correct: true, marks_obtained: true, time_taken: true },
    });

    const reviewData = filteredQuestions.map(q => {
      const userAnswer = userAnswers.find(ua => ua.question_id === q.id);
      const correctOptions = q.question_options
        .filter(opt => opt.is_correct)
        .map(opt => opt.id);

      return {
        id: q.id,
        sectionId: q.section_id,
        sectionName: attemptLanguage === 'hi' && q.exam_sections?.name_hi
          ? q.exam_sections.name_hi
          : q.exam_sections?.name || 'Section',
        passageId: q.passage_id,
        passage: q.passages
          ? {
              id: q.passages.id,
              title: q.passages.title,
              content: attemptLanguage === 'hi' && q.passages.content_hi ? q.passages.content_hi : q.passages.content,
            }
          : null,
        type: q.type,
        text: attemptLanguage === 'hi' && q.text_hi ? q.text_hi : q.text,
        marks: q.marks,
        negativeMarks: q.negative_marks,
        explanation: attemptLanguage === 'hi' && q.explanation_hi ? q.explanation_hi : q.explanation,
        explanationImageUrl: q.explanation_image_url,
        imageUrl: q.image_url,
        options: q.question_options
          .sort((a, b) => a.option_order - b.option_order)
          .map(opt => ({
            id: opt.id,
            option_text: attemptLanguage === 'hi' && opt.option_text_hi ? opt.option_text_hi : opt.option_text,
            is_correct: opt.is_correct,
            option_order: opt.option_order,
            image_url: opt.image_url
          })),
        correctAnswer: q.type === 'multiple' ? correctOptions : correctOptions[0],
        userAnswer: userAnswer?.answer || null,
        isCorrect: userAnswer?.is_correct || false,
        marksObtained: userAnswer?.marks_obtained || 0,
        timeTaken: userAnswer?.time_taken || 0
      };
    });

    res.json({
      success: true,
      data: reviewData
    });
  } catch (error) {
    logger.error('Get answer review error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch answer review'
    });
  }
};

const getIncompleteAttempts = async (req, res) => {
  try {
    let attempts;
    try {
      attempts = await prisma.exam_attempts.findMany({
        where: { user_id: req.user.id, is_submitted: false },
        select: {
          id: true, exam_id: true, language: true, created_at: true, updated_at: true,
          exams: { select: { id: true, title: true, total_questions: true, duration: true, image_url: true } },
        },
        orderBy: { updated_at: 'desc' },
      });
    } catch (error) {
      logger.error('Get incomplete attempts error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch incomplete attempts' });
    }

    // For each attempt, count how many questions have been answered
    const attemptsWithProgress = await Promise.all(
      (attempts || []).map(async (attempt) => {
        const count = await prisma.user_answers.count({
          where: { attempt_id: attempt.id, answer: { not: null } },
        });

        return {
          attemptId: attempt.id,
          examId: attempt.exam_id,
          examTitle: attempt.exams?.title || 'Unknown Exam',
          examImage: attempt.exams?.image_url || null,
          totalQuestions: attempt.exams?.total_questions || 0,
          duration: attempt.exams?.duration || 0,
          answeredQuestions: count || 0,
          language: attempt.language || 'en',
          startedAt: attempt.created_at,
          lastActivity: attempt.updated_at,
        };
      })
    );

    res.json({ success: true, data: attemptsWithProgress });
  } catch (error) {
    logger.error('Get incomplete attempts error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch incomplete attempts' });
  }
};

module.exports = {
  getResults,
  getUserStats,
  getIncompleteAttempts,
  getResultByAttemptId,
  getResultById,
  getAnswerReview
};
