const express = require('express');
const router = express.Router();
const { authenticate, adminAuth } = require('../middleware/auth');
const {
  getPopularTests,
  getPopularTestsAdmin,
  addPopularTest,
  removePopularTest,
  reorderPopularTests,
  togglePopularTestStatus
} = require('../controllers/pagePopularTestsController');

router.get('/admin/:pageIdentifier', authenticate, adminAuth, getPopularTestsAdmin);

router.post('/', authenticate, adminAuth, addPopularTest);

router.delete('/:id', authenticate, adminAuth, removePopularTest);

router.put('/:pageIdentifier/reorder', authenticate, adminAuth, reorderPopularTests);

router.patch('/:id/toggle', authenticate, adminAuth, togglePopularTestStatus);

router.get('/:pageIdentifier', getPopularTests);

module.exports = router;
