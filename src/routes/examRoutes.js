const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const examController = require('../controllers/examController');
const { authenticate, optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validation');
const supabase = require('../config/database');

router.get('/', optionalAuth, examController.getExams);

router.get('/categories', examController.getExamCategories);

router.get('/path/:parentSlug/:examSlug',
  optionalAuth,
  examController.getExamByShortPath
);

router.get('/path/:category/:subcategory/:examSlug',
  optionalAuth,
  examController.getExamByPath
);

router.get('/:id', 
  optionalAuth, 
  examController.getExamById
);

router.post('/:examId/start',
  authenticate,
  examController.startExam
);

router.get('/:examId/attempts/:attemptId/questions',
  authenticate,
  [
    param('examId').isUUID().withMessage('Valid exam ID required'),
    param('attemptId').isUUID().withMessage('Valid attempt ID required'),
    validate
  ],
  examController.getExamQuestions
);

router.post('/:attemptId/questions/:questionId/answer',
  authenticate,
  [
    param('attemptId').isUUID().withMessage('Valid attempt ID required'),
    param('questionId').isUUID().withMessage('Valid question ID required'),
    body('answer').optional(),
    body('markedForReview').optional().isBoolean(),
    body('timeTaken').optional().isInt({ min: 0 }),
    validate
  ],
  examController.saveAnswer
);

router.post('/:attemptId/submit',
  authenticate,
  [
    param('attemptId').isUUID().withMessage('Valid attempt ID required'),
    validate
  ],
  examController.submitExam
);

router.get('/:examId/download-pdf',
  optionalAuth,
  examController.getExamForPDF
);

// Debug endpoint to check exam attempts
router.get('/debug/attempts/:examId', authenticate, async (req, res) => {
  try {
    const { examId } = req.params;
    
    // Check if exam exists
    const { data: exam, error: examError } = await supabase
      .from('exams')
      .select('id, title, status')
      .eq('id', examId)
      .single();
    
    // Check all attempts for this exam
    const { data: attempts, error: attemptsError } = await supabase
      .from('exam_attempts')
      .select('id, user_id, exam_id, is_submitted, language, created_at')
      .eq('exam_id', examId);
    
    // Check attempts for current user
    const { data: userAttempts, error: userAttemptsError } = await supabase
      .from('exam_attempts')
      .select('id, user_id, exam_id, is_submitted, language, created_at')
      .eq('exam_id', examId)
      .eq('user_id', req.user.id);
    
    res.json({
      success: true,
      data: {
        exam,
        examError,
        attempts,
        attemptsError,
        userAttempts,
        userAttemptsError,
        currentUser: {
          id: req.user.id,
          email: req.user.email
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
