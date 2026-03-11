const express = require('express');
const router = express.Router();
const { authenticate, adminAuth } = require('../middleware/auth');
const currentAffairsController = require('../controllers/currentAffairsController');
const { upload } = require('../utils/fileUpload');

// Public
router.get('/', currentAffairsController.getPublicPage);

// Admin - settings
router.get('/settings', authenticate, adminAuth, currentAffairsController.getSettings);
router.put('/settings', authenticate, adminAuth, currentAffairsController.updateSettings);

// Admin - videos
router.get('/videos', authenticate, adminAuth, currentAffairsController.listVideos);
router.post('/videos', authenticate, adminAuth, currentAffairsController.createVideo);
router.put('/videos/:id', authenticate, adminAuth, currentAffairsController.updateVideo);
router.delete('/videos/:id', authenticate, adminAuth, currentAffairsController.deleteVideo);
router.post('/videos/upload', authenticate, adminAuth, upload.single('video'), currentAffairsController.uploadVideoAsset);
router.post('/videos/upload-thumbnail', authenticate, adminAuth, upload.single('image'), currentAffairsController.uploadThumbnailAsset);

// Admin - quizzes
router.get('/quizzes', authenticate, adminAuth, currentAffairsController.listQuizzes);
router.post('/quizzes', authenticate, adminAuth, currentAffairsController.createQuiz);
router.put('/quizzes/:id', authenticate, adminAuth, currentAffairsController.updateQuiz);
router.delete('/quizzes/:id', authenticate, adminAuth, currentAffairsController.deleteQuiz);

module.exports = router;
