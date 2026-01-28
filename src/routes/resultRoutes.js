const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const resultController = require('../controllers/resultController');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validation');

router.get('/', authenticate, resultController.getResults);

router.get('/stats', authenticate, resultController.getUserStats);

router.get('/attempt/:attemptId',
  authenticate,
  [
    param('attemptId').isUUID().withMessage('Valid attempt ID required'),
    validate
  ],
  resultController.getResultByAttemptId
);

router.get('/:id',
  authenticate,
  [
    param('id').isUUID().withMessage('Valid result ID required'),
    validate
  ],
  resultController.getResultById
);

router.get('/:resultId/review',
  authenticate,
  [
    param('resultId').isUUID().withMessage('Valid result ID required'),
    validate
  ],
  resultController.getAnswerReview
);

module.exports = router;
