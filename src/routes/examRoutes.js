const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const examController = require('../controllers/examController');
const { authenticate, optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validation');
const supabase = require('../config/database');

router.get('/', optionalAuth, examController.getExams);

router.get('/history', authenticate, examController.getExamHistory);

router.get('/categories', examController.getExamCategories);

router.get('/path/:parentSlug/:examSlug',
  optionalAuth,
  examController.getExamByShortPath
);

router.get('/path/:category/:subcategory/:examSlug',
  optionalAuth,
  examController.getExamByPath
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

router.get('/:id', 
  optionalAuth, 
  examController.getExamById
);

// Debug endpoint to check exam by path
router.get('/debug/path/*', async (req, res) => {
  try {
    const fullPath = req.params[0];
    const path = fullPath.startsWith('/') ? fullPath : `/${fullPath}`;
    
    console.log('Debug path lookup:', path);
    
    // Check if exam exists by url_path (without is_published filter)
    const { data: examByPathAll, error: pathErrorAll } = await supabase
      .from('exams')
      .select('id, title, url_path, slug, status, is_published, deleted_at')
      .eq('url_path', path);
    
    // Check if exam exists by url_path (with is_published filter)
    const { data: examByPath, error: pathError } = await supabase
      .from('exams')
      .select('id, title, url_path, slug, status, is_published, deleted_at')
      .eq('url_path', path)
      .eq('is_published', true)
      .is('deleted_at', null)
      .single();
    
    // Check if exam exists by slug (fallback)
    const slugFallback = path.split('/').filter(Boolean).pop();
    const { data: examBySlug, error: slugError } = await supabase
      .from('exams')
      .select('id, title, url_path, slug, status, is_published, deleted_at')
      .eq('slug', slugFallback)
      .eq('is_published', true)
      .is('deleted_at', null)
      .single();
    
    // Get all exams with similar paths or slugs
    const { data: similarExams, error: similarError } = await supabase
      .from('exams')
      .select('id, title, url_path, slug, status, is_published, deleted_at')
      .or(`url_path.ilike.%${slugFallback}%,slug.ilike.%${slugFallback}%`)
      .limit(10);
    
    res.json({
      success: true,
      data: {
        searchPath: path,
        slugFallback,
        examByPathAll: examByPathAll || [],
        pathErrorAll: pathErrorAll?.message,
        examByPath,
        pathError: pathError?.message,
        examBySlug,
        slugError: slugError?.message,
        similarExams: similarExams || [],
        similarError: similarError?.message,
        explanation: {
          examByPathAll: 'All exams matching the path (ignoring is_published and deleted_at)',
          examByPath: 'Published, non-deleted exam matching the path',
          examBySlug: 'Published, non-deleted exam matching the slug fallback',
          similarExams: 'Exams with similar paths or slugs'
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
      stack: error.stack
    });
  }
});

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
