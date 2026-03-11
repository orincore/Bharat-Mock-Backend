const express = require('express');
const router = express.Router();
const { authenticate, adminAuth, checkPermission, requireRole } = require('../middleware/auth');
const activityLogger = require('../middleware/activityLogger');
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

router.post('/categories', authenticate, adminAuth, checkPermission('categories', 'create'), activityLogger('CREATE_CATEGORY', 'category'), upload.single('logo'), taxonomyController.createCategory);
router.put('/categories/:id', authenticate, adminAuth, checkPermission('categories', 'update'), activityLogger('UPDATE_CATEGORY', 'category'), upload.single('logo'), taxonomyController.updateCategory);
router.delete('/categories/:id', authenticate, adminAuth, requireRole('admin'), activityLogger('DELETE_CATEGORY', 'category'), taxonomyController.deleteCategory);
router.post('/subcategories', authenticate, adminAuth, checkPermission('subcategories', 'create'), activityLogger('CREATE_SUBCATEGORY', 'subcategory'), upload.single('logo'), taxonomyController.createSubcategory);
router.put('/subcategories/:id', authenticate, adminAuth, checkPermission('subcategories', 'update'), activityLogger('UPDATE_SUBCATEGORY', 'subcategory'), upload.single('logo'), taxonomyController.updateSubcategory);
router.delete('/subcategories/:id', authenticate, adminAuth, requireRole('admin'), activityLogger('DELETE_SUBCATEGORY', 'subcategory'), taxonomyController.deleteSubcategory);
router.post('/subcategories/reorder', authenticate, adminAuth, checkPermission('subcategories', 'update'), activityLogger('REORDER_SUBCATEGORY', 'subcategory'), taxonomyController.reorderSubcategories);
router.post('/difficulties', authenticate, adminAuth, requireRole('admin'), activityLogger('CREATE_DIFFICULTY', 'difficulty'), taxonomyController.createDifficulty);

router.get('/categories/:categoryId/notifications', categoryContentController.getNotifications);
router.post('/categories/:categoryId/notifications', authenticate, adminAuth, requireRole('admin'), activityLogger('CREATE_CATEGORY_NOTIFICATION', 'category_notification'), categoryContentController.createNotification);
router.put('/categories/:categoryId/notifications/:notificationId', authenticate, adminAuth, requireRole('admin'), activityLogger('UPDATE_CATEGORY_NOTIFICATION', 'category_notification'), categoryContentController.updateNotification);
router.delete('/categories/:categoryId/notifications/:notificationId', authenticate, adminAuth, requireRole('admin'), activityLogger('DELETE_CATEGORY_NOTIFICATION', 'category_notification'), categoryContentController.deleteNotification);

router.get('/categories/:categoryId/syllabus', categoryContentController.getSyllabus);
router.post('/categories/:categoryId/syllabus', authenticate, adminAuth, requireRole('admin'), activityLogger('UPSERT_CATEGORY_SYLLABUS', 'category_syllabus'), categoryContentController.upsertSyllabusSection);
router.put('/categories/:categoryId/syllabus/:syllabusId', authenticate, adminAuth, requireRole('admin'), activityLogger('UPSERT_CATEGORY_SYLLABUS', 'category_syllabus'), categoryContentController.upsertSyllabusSection);
router.delete('/categories/:categoryId/syllabus/:syllabusId', authenticate, adminAuth, requireRole('admin'), activityLogger('DELETE_CATEGORY_SYLLABUS', 'category_syllabus'), categoryContentController.deleteSyllabusSection);

router.get('/categories/:categoryId/cutoffs', categoryContentController.getCutoffs);
router.post('/categories/:categoryId/cutoffs', authenticate, adminAuth, requireRole('admin'), activityLogger('UPSERT_CATEGORY_CUTOFF', 'category_cutoff'), categoryContentController.upsertCutoff);
router.put('/categories/:categoryId/cutoffs/:cutoffId', authenticate, adminAuth, requireRole('admin'), activityLogger('UPSERT_CATEGORY_CUTOFF', 'category_cutoff'), categoryContentController.upsertCutoff);
router.delete('/categories/:categoryId/cutoffs/:cutoffId', authenticate, adminAuth, requireRole('admin'), activityLogger('DELETE_CATEGORY_CUTOFF', 'category_cutoff'), categoryContentController.deleteCutoff);

router.get('/categories/:categoryId/dates', categoryContentController.getImportantDates);
router.post('/categories/:categoryId/dates', authenticate, adminAuth, requireRole('admin'), activityLogger('UPSERT_CATEGORY_DATE', 'category_date'), categoryContentController.upsertImportantDate);
router.put('/categories/:categoryId/dates/:dateId', authenticate, adminAuth, requireRole('admin'), activityLogger('UPSERT_CATEGORY_DATE', 'category_date'), categoryContentController.upsertImportantDate);
router.delete('/categories/:categoryId/dates/:dateId', authenticate, adminAuth, requireRole('admin'), activityLogger('DELETE_CATEGORY_DATE', 'category_date'), categoryContentController.deleteImportantDate);

router.get('/categories/:categoryId/tips', categoryContentController.getPreparationTips);
router.post('/categories/:categoryId/tips', authenticate, adminAuth, requireRole('admin'), activityLogger('UPSERT_CATEGORY_TIP', 'category_tip'), categoryContentController.upsertPreparationTip);
router.put('/categories/:categoryId/tips/:tipId', authenticate, adminAuth, requireRole('admin'), activityLogger('UPSERT_CATEGORY_TIP', 'category_tip'), categoryContentController.upsertPreparationTip);
router.delete('/categories/:categoryId/tips/:tipId', authenticate, adminAuth, requireRole('admin'), activityLogger('DELETE_CATEGORY_TIP', 'category_tip'), categoryContentController.deletePreparationTip);

router.get('/categories/:categoryId/articles', categoryContentController.getArticles);
router.post('/categories/:categoryId/articles', authenticate, adminAuth, requireRole('admin'), activityLogger('LINK_CATEGORY_ARTICLE', 'category_article'), categoryContentController.linkArticle);
router.delete('/categories/:categoryId/articles/:articleId', authenticate, adminAuth, requireRole('admin'), activityLogger('UNLINK_CATEGORY_ARTICLE', 'category_article'), categoryContentController.unlinkArticle);

router.get('/categories/:categoryId/custom-sections', categoryContentController.getCustomSections);
router.post('/categories/:categoryId/custom-sections', authenticate, adminAuth, requireRole('admin'), activityLogger('UPSERT_CATEGORY_SECTION', 'category_section'), categoryContentController.upsertCustomSection);
router.put('/categories/:categoryId/custom-sections/:sectionId', authenticate, adminAuth, requireRole('admin'), activityLogger('UPSERT_CATEGORY_SECTION', 'category_section'), categoryContentController.upsertCustomSection);
router.delete('/categories/:categoryId/custom-sections/:sectionId', authenticate, adminAuth, requireRole('admin'), activityLogger('DELETE_CATEGORY_SECTION', 'category_section'), categoryContentController.deleteCustomSection);

module.exports = router;
