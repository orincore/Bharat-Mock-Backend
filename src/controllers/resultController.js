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

    res.json({
      success: true,
      data: results,
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
      .eq('result_id', result.id);

    result.sectionWiseAnalysis = sectionAnalysis?.map(sa => ({
      sectionId: sa.exam_sections.id,
      sectionName: sa.exam_sections.name,
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
    delete result.exams;

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
      .select('attempt_id, exam_id, user_id')
      .eq('id', resultId)
      .eq('user_id', req.user.id)
      .single();

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Result not found'
      });
    }

    const { data: questions } = await supabase
      .from('questions')
      .select(`
        id,
        section_id,
        type,
        text,
        marks,
        negative_marks,
        explanation,
        image_url,
        question_order,
        exam_sections!inner (
          id,
          name
        ),
        question_options (
          id,
          option_text,
          is_correct,
          option_order,
          image_url
        )
      `)
      .eq('exam_id', result.exam_id)
      .order('question_order');

    const { data: userAnswers } = await supabase
      .from('user_answers')
      .select('question_id, answer, is_correct, marks_obtained, time_taken')
      .eq('attempt_id', result.attempt_id);

    const reviewData = questions.map(q => {
      const userAnswer = userAnswers.find(ua => ua.question_id === q.id);
      const correctOptions = q.question_options
        .filter(opt => opt.is_correct)
        .map(opt => opt.id);

      return {
        id: q.id,
        sectionId: q.section_id,
        sectionName: q.exam_sections?.name || 'Section',
        type: q.type,
        text: q.text,
        marks: q.marks,
        negativeMarks: q.negative_marks,
        explanation: q.explanation,
        imageUrl: q.image_url,
        options: q.question_options
          .sort((a, b) => a.option_order - b.option_order)
          .map(opt => ({
            id: opt.id,
            option_text: opt.option_text,
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
  getResultById,
  getResultByAttemptId,
  getAnswerReview
};
