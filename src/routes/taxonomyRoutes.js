const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const taxonomyController = require('../controllers/taxonomyController');

router.get('/categories', taxonomyController.getCategories);
router.get('/subcategories', taxonomyController.getSubcategories);
router.get('/difficulties', taxonomyController.getDifficulties);

router.post('/categories', authenticate, requireAdmin, taxonomyController.createCategory);
router.put('/categories/:id', authenticate, requireAdmin, taxonomyController.updateCategory);
router.post('/subcategories', authenticate, requireAdmin, taxonomyController.createSubcategory);
router.post('/difficulties', authenticate, requireAdmin, taxonomyController.createDifficulty);

module.exports = router;
