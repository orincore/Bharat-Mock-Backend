const express = require('express');
const router = express.Router();
const {
  getAllSections,
  createSection,
  updateSection,
  deleteSection,
  getTopicsBySection,
  getAllTopics,
  createTopic,
  updateTopic,
  deleteTopic,
  reorderSections,
  reorderTopics,
} = require('../controllers/paperSectionsController');
const { authenticate, adminAuth } = require('../middleware/auth');

// Public routes
router.get('/', getAllSections);
router.get('/topics', getAllTopics);
router.get('/:section_id/topics', getTopicsBySection);

// Admin routes
router.post('/reorder', authenticate, adminAuth, reorderSections);
router.post('/topics/reorder', authenticate, adminAuth, reorderTopics);
router.post('/topics', authenticate, adminAuth, createTopic);
router.put('/topics/:id', authenticate, adminAuth, updateTopic);
router.delete('/topics/:id', authenticate, adminAuth, deleteTopic);
router.post('/', authenticate, adminAuth, createSection);
router.put('/:id', authenticate, adminAuth, updateSection);
router.delete('/:id', authenticate, adminAuth, deleteSection);

module.exports = router;
