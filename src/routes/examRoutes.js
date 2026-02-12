const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const examController = require('../controllers/examController');
const { authenticate, optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validation');

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

module.exports = router;
