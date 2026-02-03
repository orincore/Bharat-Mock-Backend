const supabase = require('../config/database');
const logger = require('../config/logger');

const getResults = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const { data: results, error, count } = await supabase
      .from('results')
      .select(`
        id,
        attempt_id,
        score,
        total_marks,
        percentage,
        correct_answers,
        wrong_answers,
        unattempted,
        time_taken,
        rank,
        total_participants,
        status,
        created_at,
        exam_attempts!inner (
          language
        ),
        exams (
          id,
          title,
          category,
          image_url
        )
      `, { count: 'exact' })
      .eq('user_id', req.user.id)
      .eq('is_published', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) {
      logger.error('Get results error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch results'
      });
    }

    const formattedResults = results.map(r => ({
      ...r,
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
    const { data: results, error } = await supabase
      .from('results')
      .select('percentage, created_at')
      .eq('user_id', req.user.id)
      .eq('is_published', true)
      .order('created_at', { ascending: true });

    if (error) {
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

    const avgScore = examsTaken > 0
      ? parseFloat((results.reduce((sum, result) => sum + (result.percentage || 0), 0) / examsTaken).toFixed(1))
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

const getResultByAttemptId = async (req, res) => {
  try {
    const { attemptId } = req.params;

    const { data: result, error } = await supabase
      .from('results')
      .select(`
        id,
        score,
        total_marks,
        percentage,
        correct_answers,
        wrong_answers,
        unattempted,
        time_taken,
        rank,
        total_participants,
        status,
        created_at,
        attempt_id,
        exam_id,
        exam_attempts!inner (
          language
        ),
        exams (
          id,
          title,
          description,
          category,
          difficulty,
          image_url,
          pass_percentage,
          total_questions
        )
      `)
      .eq('attempt_id', attemptId)
      .eq('user_id', req.user.id)
      .single();

    if (error || !result) {
      return res.status(404).json({
        success: false,
        message: 'Result not found'
      });
    }

    const attemptLanguage = result.exam_attempts?.language || 'en';

    const { data: sectionAnalysis } = await supabase
      .from('section_analysis')
      .select(`
        id,
        score,
        total_marks,
        correct_answers,
        wrong_answers,
        unattempted,
        accuracy,
        time_taken,
        exam_sections (
          id,
          name,
          name_hi
        )
      `)
      .eq('result_id', result.id);

    result.sectionWiseAnalysis = sectionAnalysis?.map(sa => ({
      sectionId: sa.exam_sections.id,
      sectionName: attemptLanguage === 'hi' && sa.exam_sections.name_hi 
        ? sa.exam_sections.name_hi 
        : sa.exam_sections.name,
      score: sa.score,
      totalMarks: sa.total_marks,
      correctAnswers: sa.correct_answers,
      wrongAnswers: sa.wrong_answers,
      unattempted: sa.unattempted,
      accuracy: sa.accuracy,
      timeTaken: sa.time_taken
    })) || [];

    result.exam = {
      ...result.exams,
      id: result.exams.id,
      title: result.exams.title,
      pass_percentage: result.exams.pass_percentage,
      total_questions: result.exams.total_questions
    };
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

    const baseQuery = () => supabase
      .from('results')
      .select(`
        id,
        score,
        total_marks,
        percentage,
        correct_answers,
        wrong_answers,
        unattempted,
        time_taken,
        rank,
        total_participants,
        status,
        created_at,
        attempt_id,
        exam_id,
        exams (
          id,
          title,
          description,
          category,
          difficulty,
          image_url,
          pass_percentage,
          total_questions
        )
      `)
      .eq('user_id', req.user.id);

    let { data: result, error } = await baseQuery().eq('id', id).single();

    if ((error || !result) && !error?.details?.includes('more than one row')) {
      ({ data: result, error } = await baseQuery().eq('attempt_id', id).single());
    }

    if (error || !result) {
      return res.status(404).json({
        success: false,
        message: 'Result not found'
      });
    }

    const { data: sectionAnalysis } = await supabase
      .from('section_analysis')
      .select(`
        id,
        score,
        total_marks,
        correct_answers,
        wrong_answers,
        unattempted,
        accuracy,
        time_taken,
        exam_sections (
          id,
          name
        )
      `)
      .eq('result_id', id);

    result.sectionWiseAnalysis = sectionAnalysis.map(sa => ({
      sectionId: sa.exam_sections.id,
      sectionName: sa.exam_sections.name,
      score: sa.score,
      totalMarks: sa.total_marks,
      correctAnswers: sa.correct_answers,
      wrongAnswers: sa.wrong_answers,
      unattempted: sa.unattempted,
      accuracy: sa.accuracy,
      timeTaken: sa.time_taken
    }));

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

    const { data: result } = await supabase
      .from('results')
      .select(`
        attempt_id,
        exam_id,
        user_id,
        exam_attempts!inner (
          language
        )
      `)
      .eq('id', resultId)
      .eq('user_id', req.user.id)
      .single();

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Result not found'
      });
    }

    const attemptLanguage = result.exam_attempts?.language || 'en';

    // Get sections with language filtering (same logic as examController)
    let sectionsSelect = 'id, name, name_hi, total_questions, marks_per_question, duration, section_order';
    let sectionsData;
    let sectionsError;
    try {
      ({ data: sectionsData, error: sectionsError } = await supabase
        .from('exam_sections')
        .select(`${sectionsSelect}, language`)
        .eq('exam_id', result.exam_id));
      if (sectionsError && sectionsError.code === '42703') {
        ({ data: sectionsData, error: sectionsError } = await supabase
          .from('exam_sections')
          .select(sectionsSelect)
          .eq('exam_id', result.exam_id));
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
        explanation,
        explanation_hi,
        image_url,
        question_order,
        question_number,
        exam_sections!inner (
          id,
          name,
          name_hi,
          section_order
        ),
        question_options (
          id,
          option_text,
          option_text_hi,
          is_correct,
          option_order,
          image_url
        )
      `)
      .eq('exam_id', result.exam_id)
      .order('question_number');

    const filteredQuestions = questions.filter(q =>
      allowedSectionIds.has(q.section_id) && questionHasContent(q, attemptLanguage)
    );

    const { data: userAnswers } = await supabase
      .from('user_answers')
      .select('question_id, answer, is_correct, marks_obtained, time_taken')
      .eq('attempt_id', result.attempt_id);

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
        type: q.type,
        text: attemptLanguage === 'hi' && q.text_hi ? q.text_hi : q.text,
        marks: q.marks,
        negativeMarks: q.negative_marks,
        explanation: attemptLanguage === 'hi' && q.explanation_hi ? q.explanation_hi : q.explanation,
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

module.exports = {
  getResults,
  getUserStats,
  getResultByAttemptId,
  getResultById,
  getAnswerReview
};
