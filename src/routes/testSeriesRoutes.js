const express = require('express');
const router = express.Router();
const {
  getAllTestSeries,
  getTestSeriesById,
  getTestSeriesBySlug,
  createTestSeries,
  updateTestSeries,
  deleteTestSeries,
  createSection,
  updateSection,
  deleteSection,
  createTopic,
  updateTopic,
  deleteTopic,
  getSectionsByTestSeries,
  getTopicsBySection
} = require('../controllers/testSeriesController');
const { authenticate, adminAuth } = require('../middleware/auth');

// Public routes
router.get('/', getAllTestSeries);
router.get('/slug/:slug', getTestSeriesBySlug);
router.get('/:id', getTestSeriesById);
router.get('/:test_series_id/sections', getSectionsByTestSeries);
router.get('/sections/:section_id/topics', getTopicsBySection);

// Admin routes
router.post('/', authenticate, adminAuth, createTestSeries);
router.put('/:id', authenticate, adminAuth, updateTestSeries);
router.delete('/:id', authenticate, adminAuth, deleteTestSeries);

router.post('/sections', authenticate, adminAuth, createSection);
router.put('/sections/:id', authenticate, adminAuth, updateSection);
router.delete('/sections/:id', authenticate, adminAuth, deleteSection);

router.post('/topics', authenticate, adminAuth, createTopic);
router.put('/topics/:id', authenticate, adminAuth, updateTopic);
router.delete('/topics/:id', authenticate, adminAuth, deleteTopic);

module.exports = router;
