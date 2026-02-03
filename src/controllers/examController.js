const supabase = require('../config/database');
const logger = require('../config/logger');

const getExams = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search, 
      category, 
      status, 
      difficulty,
      exam_type
    } = req.query;

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
        category,
        difficulty,
        status,
        start_date,
        end_date,
        pass_percentage,
        is_free,
        price,
        image_url,
        logo_url,
        thumbnail_url,
        negative_marking,
        negative_mark_value,
        allow_anytime,
        supports_hindi,
        exam_type,
        show_in_mock_tests,
        slug,
        url_path
      `, { count: 'exact' })
      .eq('is_published', true)
      .is('deleted_at', null)
      .order('start_date', { ascending: false });

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    if (category) {
      query = query.eq('category', category);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (difficulty) {
      query = query.eq('difficulty', difficulty);
    }

    if (exam_type) {
      if (exam_type === 'mock_test') {
        query = query.or('exam_type.eq.mock_test,and(exam_type.eq.past_paper,show_in_mock_tests.eq.true)');
      } else if (exam_type === 'all') {
        // no-op to include every type
      } else {
        query = query.eq('exam_type', exam_type);
      }
    } else {
      query = query.or('exam_type.eq.mock_test,and(exam_type.eq.past_paper,show_in_mock_tests.eq.true)');
    }

    query = query.range(offset, offset + parseInt(limit) - 1);

    const { data: exams, error, count } = await query;

    if (error) {
      logger.error('Get exams error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch exams'
      });
    }

    for (let exam of exams) {
      const { data: syllabus } = await supabase
        .from('exam_syllabus')
        .select('topic')
        .eq('exam_id', exam.id);
      
      exam.syllabus = syllabus?.map(s => s.topic) || [];
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
    logger.error('Get exams error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exams'
    });
  }
};

const getExamByPath = async (req, res) => {
  try {
    const { category, subcategory, examSlug } = req.params;
    const path = `/${category}/${subcategory}/${examSlug}`;
    const { exam, error } = await fetchExamByIdentifier(path);

    if (error || !exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    await enrichExamDetails(exam, req.user);

    res.json({
      success: true,
      data: exam
    });
  } catch (error) {
    logger.error('Get exam by path error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exam details'
    });
  }
};

const buildExamQuery = () => {
  return supabase
    .from('exams')
    .select(`
      id,
      title,
      description,
      duration,
      total_marks,
      total_questions,
      category,
      difficulty,
      status,
      start_date,
      end_date,
      pass_percentage,
      is_free,
      price,
      image_url,
      logo_url,
      thumbnail_url,
      negative_marking,
      negative_mark_value,
      allow_anytime,
      supports_hindi,
      slug,
      url_path
    `)
    .eq('is_published', true)
    .is('deleted_at', null);
};

const fetchExamByIdentifier = async (identifier) => {
  const normalizedId = identifier?.trim() || '';
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizedId);
  const isUrlPath = normalizedId.includes('/') && normalizedId.length > 0;

  const slugFallback = normalizedId
    .split('/')
    .filter(Boolean)
    .pop();

  const runQuery = async (filter) => buildExamQuery().match(filter).single();

  if (isUUID) {
    return runQuery({ id: normalizedId });
  }

  if (isUrlPath) {
    const path = normalizedId.startsWith('/') ? normalizedId : `/${normalizedId}`;
    let { data: exam, error } = await buildExamQuery().eq('url_path', path).single();

    if (!exam && slugFallback) {
      ({ data: exam, error } = await buildExamQuery().eq('slug', slugFallback).single());
    }

    return { exam, error };
  }

  return runQuery({ slug: normalizedId });
};

const enrichExamDetails = async (exam, user) => {
  const { data: syllabus } = await supabase
    .from('exam_syllabus')
    .select('topic')
    .eq('exam_id', exam.id);

  const { data: sections } = await supabase
    .from('exam_sections')
    .select('id, name, total_questions, marks_per_question, duration, section_order')
    .eq('exam_id', exam.id)
    .order('section_order');

  exam.syllabus = syllabus?.map(s => s.topic) || [];
  exam.pattern = {
    sections: sections || [],
    negativeMarking: exam.negative_marking,
    negativeMarkValue: exam.negative_mark_value
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

const getExamById = async (req, res) => {
  try {
    const { id } = req.params;
    const { attemptId } = req.query || {};

    let { exam, error } = await fetchExamByIdentifier(id);

    if ((error || !exam) && req.user) {
      const { data: unpublishedExam, error: unpublishedError } = await supabase
        .from('exams')
        .select(`
          id,
          title,
          description,
          duration,
          total_marks,
          total_questions,
          category,
          difficulty,
          status,
          start_date,
          end_date,
          pass_percentage,
          is_free,
          price,
          image_url,
          logo_url,
          thumbnail_url,
          negative_marking,
          negative_mark_value,
          allow_anytime,
          slug,
          url_path
        `)
        .eq('id', id)
        .is('deleted_at', null)
        .single();

      if (!unpublishedError && unpublishedExam) {
        const { data: userAttempts, error: attemptsError } = await supabase
          .from('exam_attempts')
          .select('id')
          .eq('exam_id', id)
          .eq('user_id', req.user.id)
          .order('created_at', { ascending: false })
          .limit(1);

        if (!attemptsError && userAttempts && userAttempts.length > 0) {
          exam = unpublishedExam;
          error = null;
        }
      }
    }

    if ((error || !exam) && attemptId) {
      const { data: attempt, error: attemptError } = await supabase
        .from('exam_attempts')
        .select('id, user_id')
        .eq('id', attemptId)
        .eq('exam_id', id)
        .single();

      if (!attemptError && attempt) {
        const { data: unpublishedExamByAttempt, error: attemptExamError } = await supabase
          .from('exams')
          .select(`
            id,
            title,
            description,
            duration,
            total_marks,
            total_questions,
            category,
            difficulty,
            status,
            start_date,
            end_date,
            pass_percentage,
            is_free,
            price,
            image_url,
            logo_url,
            thumbnail_url,
            negative_marking,
            negative_mark_value,
            allow_anytime,
            slug,
            url_path
          `)
          .eq('id', id)
          .is('deleted_at', null)
          .single();

        if (!attemptExamError && unpublishedExamByAttempt) {
          exam = unpublishedExamByAttempt;
          error = null;
        }
      }
    }

    if (error || !exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    await enrichExamDetails(exam, req.user);

    res.json({
      success: true,
      data: exam
    });
  } catch (error) {
    logger.error('Get exam by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exam details'
    });
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
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch categories'
      });
    }

    const uniqueCategories = [...new Set(categories.map(c => c.category))];

    res.json({
      success: true,
      data: uniqueCategories
    });
  } catch (error) {
    logger.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories'
    });
  }
};

const startExam = async (req, res) => {
  try {
    const { examId } = req.params;
    const { language = 'en' } = req.body;

    const { data: exam, error: examError } = await supabase
      .from('exams')
      .select('id, status, start_date, end_date, is_free, price, allow_anytime, supports_hindi')
      .eq('id', examId)
      .eq('is_published', true)
      .is('deleted_at', null)
      .single();

    if (examError || !exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    const allowAnytime = exam.allow_anytime === true;

    if (!allowAnytime) {
      if (exam.status !== 'ongoing') {
        return res.status(400).json({
          success: false,
          message: 'Exam is not currently available'
        });
      }

      const now = new Date();
      if (new Date(exam.start_date) > now || new Date(exam.end_date) < now) {
        return res.status(400).json({
          success: false,
          message: 'Exam is not within the allowed time window'
        });
      }
    }

    if (language !== 'en' && language !== 'hi') {
      return res.status(400).json({
        success: false,
        message: 'Invalid language. Must be "en" or "hi"'
      });
    }

    if (language === 'hi' && !exam.supports_hindi) {
      return res.status(400).json({
        success: false,
        message: 'Hindi language not supported for this exam'
      });
    }

    if (!exam.is_free) {
      const { data: payment } = await supabase
        .from('transactions')
        .select('id')
        .eq('user_id', req.user.id)
        .eq('exam_id', examId)
        .eq('status', 'success')
        .single();

      if (!payment) {
        return res.status(403).json({
          success: false,
          message: 'Payment required to access this exam'
        });
      }
    }

    const { data: attempt, error: attemptError } = await supabase
      .from('exam_attempts')
      .insert({
        exam_id: examId,
        user_id: req.user.id,
        language: language,
        ip_address: req.ip,
        user_agent: req.headers['user-agent']
      })
      .select('id, started_at, language')
      .single();

    if (attemptError) {
      logger.error('Start exam error:', attemptError);
      return res.status(500).json({
        success: false,
        message: 'Failed to start exam'
      });
    }

    res.json({
      success: true,
      message: 'Exam started successfully',
      data: {
        attemptId: attempt.id,
        startedAt: attempt.started_at,
        language: attempt.language
      }
    });
  } catch (error) {
    logger.error('Start exam error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start exam'
    });
  }
};

const getExamQuestions = async (req, res) => {
  try {
    const { examId, attemptId } = req.params;

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
        message: 'Exam attempt not found'
      });
    }

    if (attempt.is_submitted) {
      return res.status(400).json({
        success: false,
        message: 'Exam already submitted'
      });
    }

    const attemptLanguage = attempt.language || 'en';

    let sectionsSelect = 'id, name, name_hi, total_questions, marks_per_question, duration, section_order';
    let sectionsData;
    let sectionsError;
    try {
      ({ data: sectionsData, error: sectionsError } = await supabase
        .from('exam_sections')
        .select(`${sectionsSelect}, language`)
        .eq('exam_id', examId)
        .order('section_order'));
      if (sectionsError && sectionsError.code === '42703') {
        ({ data: sectionsData, error: sectionsError } = await supabase
          .from('exam_sections')
          .select(sectionsSelect)
          .eq('exam_id', examId)
          .order('section_order'));
      }
    } catch (err) {
      sectionsData = null;
      sectionsError = err;
    }

    let sections = (sectionsData || []).map(section => ({
      ...section,
      language: section.language || attemptLanguage
    }));

    if (sectionsError) {
      logger.error('Get sections error:', sectionsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch exam sections'
      });
    }

    const { data: questions, error: questionsError } = await supabase
      .from('questions')
      .select(`
        id,
        section_id,
        type,
        text,
        text_hi,
        marks,
        negative_marks,
        explanation,
        explanation_hi,
        image_url,
        question_order,
        question_number,
        question_options (
          id,
          option_text,
          option_text_hi,
          option_order,
          image_url
        )
      `)
      .eq('exam_id', examId)
      .is('deleted_at', null)
      .order('question_number');

    if (questionsError) {
      logger.error('Get questions error:', questionsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch questions'
      });
    }

    const { data: userAnswers } = await supabase
      .from('user_answers')
      .select('question_id, answer, marked_for_review, time_taken')
      .eq('attempt_id', attemptId);

    const hasValue = (value) => typeof value === 'string' && value.trim().length > 0;

    const optionHasContent = (option, language) => {
      if (language === 'hi') {
        return Boolean(
          hasValue(option.option_text_hi) ||
          hasValue(option.image_url)
        );
      }
      return Boolean(
        hasValue(option.option_text) ||
        hasValue(option.image_url)
      );
    };

    const questionHasContent = (question, language) => {
      const questionHasImage = hasValue(question.image_url);
      if (language === 'hi') {
        return Boolean(
          hasValue(question.text_hi) ||
          hasValue(question.explanation_hi) ||
          questionHasImage ||
          (question.question_options && question.question_options.some(opt => optionHasContent(opt, 'hi')))
        );
      }
      return Boolean(
        hasValue(question.text) ||
        hasValue(question.explanation) ||
        questionHasImage ||
        (question.question_options && question.question_options.some(opt => optionHasContent(opt, 'en')))
      );
    };

    const buildFilteredQuestions = (language) => {
      const filtered = questions.filter(question => questionHasContent(question, language));
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
      userAnswer: userAnswers?.find(ua => ua.question_id === q.id) || null
    }));

    const sectionQuestionMap = new Map();
    const sectionLanguageMap = new Map();
    sections.forEach(section => {
      sectionLanguageMap.set(section.id, section.language || 'en');
    });

    questionsWithAnswers.forEach(question => {
      if (!sectionQuestionMap.has(question.section_id)) {
        sectionQuestionMap.set(question.section_id, []);
      }
      sectionQuestionMap.get(question.section_id).push(question);
    });

    const sectionsWithQuestions = sections
      .map(section => {
        const derivedLanguage = sectionLanguageMap.get(section.id) || attemptLanguage;
        if (derivedLanguage !== languageUsed) {
          return null;
        }

        const sectionQuestions = (sectionQuestionMap.get(section.id) || [])
          .sort((a, b) => (a.question_number || a.question_order || 0) - (b.question_number || b.question_order || 0));

        if (sectionQuestions.length === 0) {
          return null;
        }

        return {
          id: section.id,
          name: section.name,
          name_hi: section.name_hi || null,
          language: derivedLanguage,
          totalQuestions: sectionQuestions.length,
          marksPerQuestion: section.marks_per_question,
          duration: section.duration,
          sectionOrder: section.section_order,
          questions: sectionQuestions
        };
      })
      .filter(Boolean);

    res.json({
      success: true,
      data: {
        sections: sectionsWithQuestions,
        questions: questionsWithAnswers
      }
    });
  } catch (error) {
    logger.error('Get exam questions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exam questions'
    });
  }
};

const saveAnswer = async (req, res) => {
  try {
    const { attemptId, questionId } = req.params;
    const { answer, markedForReview, timeTaken } = req.body;

    const { data: attempt } = await supabase
      .from('exam_attempts')
      .select('id, user_id, is_submitted')
      .eq('id', attemptId)
      .eq('user_id', req.user.id)
      .single();

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: 'Exam attempt not found'
      });
    }

    if (attempt.is_submitted) {
      return res.status(400).json({
        success: false,
        message: 'Cannot save answer after exam submission'
      });
    }

    const { data: existingAnswer } = await supabase
      .from('user_answers')
      .select('id')
      .eq('attempt_id', attemptId)
      .eq('question_id', questionId)
      .single();

    // Helper function to check if answer has actual value
    const hasAnswerValue = (value) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      if (typeof value === 'string') {
        return value.trim().length > 0;
      }
      return Boolean(value);
    };

    const hasAnswer = hasAnswerValue(answer);
    const isMarked = markedForReview || false;

    if (existingAnswer) {
      if (!hasAnswer && !isMarked) {
        // Delete the record if no answer and not marked
        await supabase
          .from('user_answers')
          .delete()
          .eq('id', existingAnswer.id);
      } else {
        // Update with answer or mark status
        await supabase
          .from('user_answers')
          .update({
            answer: hasAnswer ? answer : null,
            marked_for_review: isMarked,
            time_taken: timeTaken || 0
          })
          .eq('id', existingAnswer.id);
      }
    } else if (hasAnswer || isMarked) {
      // Only insert if there's an answer or it's marked for review
      await supabase
        .from('user_answers')
        .insert({
          attempt_id: attemptId,
          question_id: questionId,
          answer: hasAnswer ? answer : null,
          marked_for_review: isMarked,
          time_taken: timeTaken || 0
        });
    }

    res.json({
      success: true,
      message: 'Answer saved successfully'
    });
  } catch (error) {
    logger.error('Save answer error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save answer'
    });
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

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: 'Exam attempt not found'
      });
    }

    if (attempt.is_submitted) {
      return res.status(400).json({
        success: false,
        message: 'Exam already submitted'
      });
    }

    const submittedAt = new Date();
    const timeTaken = Math.floor((submittedAt - new Date(attempt.started_at)) / 1000);

    await supabase
      .from('exam_attempts')
      .update({
        is_submitted: true,
        submitted_at: submittedAt.toISOString(),
        time_taken: timeTaken
      })
      .eq('id', attemptId);

    await evaluateExam(attemptId, attempt.exam_id, req.user.id);

    res.json({
      success: true,
      message: 'Exam submitted successfully',
      data: {
        attemptId,
        submittedAt
      }
    });
  } catch (error) {
    logger.error('Submit exam error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit exam'
    });
  }
};

const evaluateExam = async (attemptId, examId, userId) => {
  try {
    const { data: attemptData } = await supabase
      .from('exam_attempts')
      .select('language')
      .eq('id', attemptId)
      .single();

    const attemptLanguage = attemptData?.language || 'en';

    let sectionsSelect = 'id, name, name_hi, total_questions, marks_per_question, duration, section_order';
    let sectionsData;
    let sectionsError;
    try {
      ({ data: sectionsData, error: sectionsError } = await supabase
        .from('exam_sections')
        .select(`${sectionsSelect}, language`)
        .eq('exam_id', examId));
      if (sectionsError && sectionsError.code === '42703') {
        ({ data: sectionsData, error: sectionsError } = await supabase
          .from('exam_sections')
          .select(sectionsSelect)
          .eq('exam_id', examId));
      }
    } catch (err) {
      sectionsData = null;
      sectionsError = err;
    }

    if (sectionsError) {
      throw sectionsError;
    }

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

    const { data: questions } = await supabase
      .from('questions')
      .select(`
        id,
        section_id,
        type,
        text,
        text_hi,
        marks,
        negative_marks,
        question_options!inner (
          id,
          is_correct,
          option_text,
          option_text_hi
        )
      `)
      .eq('exam_id', examId);

    const filteredQuestions = questions.filter(q =>
      allowedSectionIds.has(q.section_id) && questionHasContent(q, attemptLanguage)
    );

    if (filteredQuestions.length === 0) {
      throw new Error('No questions available for evaluation in selected language');
    }

    const sectionTotals = {};
    filteredQuestions.forEach(question => {
      if (!sectionTotals[question.section_id]) {
        sectionTotals[question.section_id] = {
          totalMarks: 0,
          totalQuestions: 0
        };
      }
      sectionTotals[question.section_id].totalMarks += question.marks || 0;
      sectionTotals[question.section_id].totalQuestions += 1;
    });

    const attemptTotalMarks = Object.values(sectionTotals)
      .reduce((sum, section) => sum + section.totalMarks, 0) || 0;

    const { data: userAnswers } = await supabase
      .from('user_answers')
      .select('id, question_id, answer, time_taken')
      .eq('attempt_id', attemptId);

    let totalScore = 0;
    let correctAnswers = 0;
    let wrongAnswers = 0;
    let unattempted = 0;

    const sectionScores = {};

    for (const question of filteredQuestions) {
      const userAnswer = userAnswers.find(ua => ua.question_id === question.id);
      
      if (!userAnswer || !userAnswer.answer) {
        unattempted++;
        await supabase
          .from('user_answers')
          .update({ is_correct: false, marks_obtained: 0 })
          .eq('question_id', question.id)
          .eq('attempt_id', attemptId);
        continue;
      }

      const correctOptions = question.question_options
        .filter(opt => opt.is_correct)
        .map(opt => opt.id);

      let isCorrect = false;

      // Debug logging for answer comparison
      logger.info('Answer evaluation debug:', {
        questionId: question.id,
        questionType: question.type,
        userAnswer: userAnswer.answer,
        userAnswerType: typeof userAnswer.answer,
        correctOptions: correctOptions,
        correctOptionsTypes: correctOptions.map(opt => typeof opt)
      });

      if (question.type === 'single' || question.type === 'truefalse') {
        // Ensure both are strings for comparison
        const userAnswerStr = String(userAnswer.answer);
        const correctOptionsStr = correctOptions.map(opt => String(opt));
        isCorrect = correctOptionsStr.includes(userAnswerStr);
      } else if (question.type === 'multiple') {
        let userAnswerArray;
        try {
          userAnswerArray = Array.isArray(userAnswer.answer) 
            ? userAnswer.answer 
            : JSON.parse(userAnswer.answer);
        } catch (e) {
          // If JSON parse fails, treat as single answer
          userAnswerArray = [userAnswer.answer];
        }
        
        // Ensure all are strings for comparison
        const userAnswerStrArray = userAnswerArray.map(ans => String(ans));
        const correctOptionsStr = correctOptions.map(opt => String(opt));
        
        isCorrect = correctOptionsStr.length === userAnswerStrArray.length &&
          correctOptionsStr.every(opt => userAnswerStrArray.includes(opt));
      } else if (question.type === 'numerical') {
        isCorrect = parseFloat(userAnswer.answer) === parseFloat(correctOptions[0]);
      }

      const marksObtained = isCorrect 
        ? question.marks 
        : -(question.negative_marks || 0);

      totalScore += marksObtained;

      if (isCorrect) {
        correctAnswers++;
      } else {
        wrongAnswers++;
      }

      await supabase
        .from('user_answers')
        .update({ is_correct: isCorrect, marks_obtained: marksObtained })
        .eq('id', userAnswer.id);

      if (!sectionScores[question.section_id]) {
        sectionScores[question.section_id] = {
          score: 0,
          correct: 0,
          wrong: 0,
          unattempted: 0,
          timeTaken: 0
        };
      }

      sectionScores[question.section_id].score += marksObtained;
      if (isCorrect) sectionScores[question.section_id].correct++;
      else sectionScores[question.section_id].wrong++;
      sectionScores[question.section_id].timeTaken += userAnswer.time_taken || 0;
    }

    // Add unattempted counts to section breakdown
    filteredQuestions.forEach(question => {
      if (!sectionScores[question.section_id]) {
        sectionScores[question.section_id] = {
          score: 0,
          correct: 0,
          wrong: 0,
          unattempted: 0,
          timeTaken: 0
        };
      }
    });

    const { data: exam } = await supabase
      .from('exams')
      .select('total_marks, pass_percentage')
      .eq('id', examId)
      .single();

    const denominator = attemptTotalMarks || exam.total_marks;
    const percentage = denominator > 0 ? (totalScore / denominator) * 100 : 0;
    const status = percentage >= exam.pass_percentage ? 'pass' : 'fail';

    const { data: attemptRecord } = await supabase
      .from('exam_attempts')
      .select('time_taken')
      .eq('id', attemptId)
      .single();

    const { data: result } = await supabase
      .from('results')
      .insert({
        attempt_id: attemptId,
        exam_id: examId,
        user_id: userId,
        score: totalScore,
        total_marks: denominator,
        percentage: percentage,
        correct_answers: correctAnswers,
        wrong_answers: wrongAnswers,
        unattempted: unattempted,
        time_taken: attemptRecord.time_taken,
        status: status,
        is_published: true
      })
      .select('id')
      .single();

    for (const [sectionId, scores] of Object.entries(sectionScores)) {
      const { data: section } = await supabase
        .from('exam_sections')
        .select('name, total_questions, marks_per_question, language, name_hi')
        .eq('id', sectionId)
        .single();

      if (!section || (section.language || attemptLanguage) !== attemptLanguage) {
        continue;
      }

      const sectionTotal = sectionTotals[sectionId]?.totalMarks || (section.total_questions * section.marks_per_question);
      const sectionQuestionTotal = sectionTotals[sectionId]?.totalQuestions || section.total_questions;
      const sectionUnattempted = sectionQuestionTotal - (scores.correct + scores.wrong);
      scores.unattempted = Math.max(sectionUnattempted, 0);

      const accuracy = scores.correct + scores.wrong > 0
        ? (scores.correct / (scores.correct + scores.wrong)) * 100
        : 0;

      await supabase
        .from('section_analysis')
        .insert({
          result_id: result.id,
          section_id: sectionId,
          score: scores.score,
          total_marks: sectionTotal,
          correct_answers: scores.correct,
          wrong_answers: scores.wrong,
          unattempted: scores.unattempted,
          accuracy: accuracy,
          time_taken: scores.timeTaken
        });
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
      .select(`
        *,
        exam_categories(name, slug),
        exam_subcategories(name, slug),
        exam_difficulties(name)
      `)
      .eq('id', examId)
      .eq('is_published', true)
      .is('deleted_at', null)
      .single();

    if (examError || !exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    const { data: sections, error: sectionsError } = await supabase
      .from('exam_sections')
      .select('*')
      .eq('exam_id', examId)
      .order('section_order', { ascending: true });

    if (sectionsError) {
      logger.error('Get sections error:', sectionsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch exam sections'
      });
    }

    const { data: questions, error: questionsError } = await supabase
      .from('questions')
      .select(`
        *,
        question_options(*)
      `)
      .eq('exam_id', examId)
      .order('question_number', { ascending: true });

    if (questionsError) {
      logger.error('Get questions error:', questionsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch exam questions'
      });
    }

    const questionsWithOptions = questions.map(q => ({
      ...q,
      options: (q.question_options || []).sort((a, b) => (a.option_order ?? 0) - (b.option_order ?? 0))
    }));

    res.json({
      success: true,
      data: {
        exam,
        sections,
        questions: questionsWithOptions
      }
    });
  } catch (error) {
    logger.error('Get exam for PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exam data for PDF'
    });
  }
};

module.exports = {
  getExams,
  getExamByPath,
  getExamById,
  getExamCategories,
  startExam,
  getExamQuestions,
  saveAnswer,
  submitExam,
  getExamForPDF
};
