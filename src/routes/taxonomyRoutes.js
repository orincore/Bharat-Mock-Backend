const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { upload } = require('../utils/fileUpload');
const taxonomyController = require('../controllers/taxonomyController');
const categoryContentController = require('../controllers/categoryContentController');

router.get('/categories', taxonomyController.getCategories);
router.get('/categories/:slug', taxonomyController.getCategoryBySlug);
router.get('/category-id/:id', taxonomyController.getCategoryById);
router.get('/subcategory-id/:id', taxonomyController.getSubcategoryById);
router.get('/categories/:slug/exams', taxonomyController.getExamsByCategory);
router.get('/subcategories', taxonomyController.getSubcategories);
router.get('/difficulties', taxonomyController.getDifficulties);

// Root-level category routes (for cleaner URLs like /ssc instead of /categories/ssc)
router.get('/category/:slug', taxonomyController.getCategoryBySlug);
router.get('/category/:slug/exams', taxonomyController.getExamsByCategory);

// Subcategory routes
router.get('/category/:categorySlug/subcategory/:subcategorySlug', taxonomyController.getSubcategoryBySlug);
router.get('/category/:categorySlug/subcategory/:subcategorySlug/exams', taxonomyController.getExamsBySubcategory);

// Direct subcategory slug routes (independent of category)
router.get('/subcategory/:slug', taxonomyController.getSubcategoryByOwnSlug);
router.get('/subcategory/:slug/exams', taxonomyController.getExamsBySubcategorySlug);

// Combined slug resolution (e.g. "ssc-test-test-ssc" → category "ssc-test" + subcategory "test-ssc")
router.get('/resolve/:combinedSlug', taxonomyController.resolveCombinedSlug);

router.post('/categories', authenticate, requireAdmin, upload.single('logo'), taxonomyController.createCategory);
router.put('/categories/:id', authenticate, requireAdmin, upload.single('logo'), taxonomyController.updateCategory);
router.delete('/categories/:id', authenticate, requireAdmin, taxonomyController.deleteCategory);
router.post('/subcategories', authenticate, requireAdmin, upload.single('logo'), taxonomyController.createSubcategory);
router.put('/subcategories/:id', authenticate, requireAdmin, upload.single('logo'), taxonomyController.updateSubcategory);
router.delete('/subcategories/:id', authenticate, requireAdmin, taxonomyController.deleteSubcategory);
router.post('/subcategories/reorder', authenticate, requireAdmin, taxonomyController.reorderSubcategories);
router.post('/difficulties', authenticate, requireAdmin, taxonomyController.createDifficulty);

router.get('/categories/:categoryId/notifications', categoryContentController.getNotifications);
router.post('/categories/:categoryId/notifications', authenticate, requireAdmin, categoryContentController.createNotification);
router.put('/categories/:categoryId/notifications/:notificationId', authenticate, requireAdmin, categoryContentController.updateNotification);
router.delete('/categories/:categoryId/notifications/:notificationId', authenticate, requireAdmin, categoryContentController.deleteNotification);

router.get('/categories/:categoryId/syllabus', categoryContentController.getSyllabus);
router.post('/categories/:categoryId/syllabus', authenticate, requireAdmin, categoryContentController.upsertSyllabusSection);
router.put('/categories/:categoryId/syllabus/:syllabusId', authenticate, requireAdmin, categoryContentController.upsertSyllabusSection);
router.delete('/categories/:categoryId/syllabus/:syllabusId', authenticate, requireAdmin, categoryContentController.deleteSyllabusSection);

router.get('/categories/:categoryId/cutoffs', categoryContentController.getCutoffs);
router.post('/categories/:categoryId/cutoffs', authenticate, requireAdmin, categoryContentController.upsertCutoff);
router.put('/categories/:categoryId/cutoffs/:cutoffId', authenticate, requireAdmin, categoryContentController.upsertCutoff);
router.delete('/categories/:categoryId/cutoffs/:cutoffId', authenticate, requireAdmin, categoryContentController.deleteCutoff);

router.get('/categories/:categoryId/dates', categoryContentController.getImportantDates);
router.post('/categories/:categoryId/dates', authenticate, requireAdmin, categoryContentController.upsertImportantDate);
router.put('/categories/:categoryId/dates/:dateId', authenticate, requireAdmin, categoryContentController.upsertImportantDate);
router.delete('/categories/:categoryId/dates/:dateId', authenticate, requireAdmin, categoryContentController.deleteImportantDate);

router.get('/categories/:categoryId/tips', categoryContentController.getPreparationTips);
router.post('/categories/:categoryId/tips', authenticate, requireAdmin, categoryContentController.upsertPreparationTip);
router.put('/categories/:categoryId/tips/:tipId', authenticate, requireAdmin, categoryContentController.upsertPreparationTip);
router.delete('/categories/:categoryId/tips/:tipId', authenticate, requireAdmin, categoryContentController.deletePreparationTip);

router.get('/categories/:categoryId/articles', categoryContentController.getArticles);
router.post('/categories/:categoryId/articles', authenticate, requireAdmin, categoryContentController.linkArticle);
router.delete('/categories/:categoryId/articles/:articleId', authenticate, requireAdmin, categoryContentController.unlinkArticle);

router.get('/categories/:categoryId/custom-sections', categoryContentController.getCustomSections);
router.post('/categories/:categoryId/custom-sections', authenticate, requireAdmin, categoryContentController.upsertCustomSection);
router.put('/categories/:categoryId/custom-sections/:sectionId', authenticate, requireAdmin, categoryContentController.upsertCustomSection);
router.delete('/categories/:categoryId/custom-sections/:sectionId', authenticate, requireAdmin, categoryContentController.deleteCustomSection);

module.exports = router;
