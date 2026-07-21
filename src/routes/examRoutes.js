const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const examController = require('../controllers/examController');
const { authenticate, optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validation');
const prisma = require('../config/prisma');

router.get('/', optionalAuth, examController.getExams);

router.get('/history', authenticate, examController.getExamHistory);

router.get('/categories', examController.getExamCategories);

// Public quizzes grouped by Test Series section/topic (for the /quizzes page)
router.get('/quizzes-grouped', examController.getQuizGroups);

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

router.get('/:examId/attempts/resume',
  authenticate,
  examController.getResumeAttempts
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

// Server-side rendered question-paper PDF (headless Chromium) — streamed as a file.
router.get('/:examId/pdf-file',
  optionalAuth,
  examController.downloadExamPdfFile
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
    
    const examSelect = { id: true, title: true, url_path: true, slug: true, status: true, is_published: true, deleted_at: true };

    // Check if exam exists by url_path (without is_published filter)
    const examByPathAll = await prisma.exams.findMany({
      where: { url_path: path },
      select: examSelect,
    });

    // Check if exam exists by url_path (with is_published filter)
    const examByPath = await prisma.exams.findFirst({
      where: { url_path: path, is_published: true, deleted_at: null },
      select: examSelect,
    });

    // Check if exam exists by slug (fallback)
    const slugFallback = path.split('/').filter(Boolean).pop();
    const examBySlug = await prisma.exams.findFirst({
      where: { slug: slugFallback, is_published: true, deleted_at: null },
      select: examSelect,
    });

    // Get all exams with similar paths or slugs
    const similarExams = await prisma.exams.findMany({
      where: {
        OR: [
          { url_path: { contains: slugFallback, mode: 'insensitive' } },
          { slug: { contains: slugFallback, mode: 'insensitive' } },
        ],
      },
      select: examSelect,
      take: 10,
    });

    res.json({
      success: true,
      data: {
        searchPath: path,
        slugFallback,
        examByPathAll: examByPathAll || [],
        examByPath,
        examBySlug,
        similarExams: similarExams || [],
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
    const attemptSelect = { id: true, user_id: true, exam_id: true, is_submitted: true, language: true, created_at: true };

    // Check if exam exists
    const exam = await prisma.exams.findUnique({
      where: { id: examId },
      select: { id: true, title: true, status: true },
    });

    // Check all attempts for this exam
    const attempts = await prisma.exam_attempts.findMany({
      where: { exam_id: examId },
      select: attemptSelect,
    });

    // Check attempts for current user
    const userAttempts = await prisma.exam_attempts.findMany({
      where: { exam_id: examId, user_id: req.user.id },
      select: attemptSelect,
    });

    res.json({
      success: true,
      data: {
        exam,
        attempts,
        userAttempts,
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
