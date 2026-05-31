const express = require('express');
const router = express.Router();
const { getExamTranslations, saveExamTranslations } = require('../controllers/examTranslationsController');
const { optionalAuth } = require('../middleware/auth');

// GET  /api/v1/exam-translations/:examId?lang=hi
router.get('/:examId', optionalAuth, getExamTranslations);

// POST /api/v1/exam-translations/:examId
router.post('/:examId', optionalAuth, saveExamTranslations);

module.exports = router;
