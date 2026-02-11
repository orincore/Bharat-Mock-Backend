const express = require('express');
const router = express.Router();
const categoryPageContentController = require('../controllers/categoryPageContentController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { upload } = require('../utils/fileUpload');

router.get('/:categoryId', categoryPageContentController.getPageContent);

router.post('/:categoryId/bulk-sync', authenticate, requireAdmin, categoryPageContentController.bulkSyncPageContent);

router.get('/:categoryId/custom-tabs', categoryPageContentController.getCustomTabs);
router.post('/:categoryId/custom-tabs', authenticate, requireAdmin, categoryPageContentController.createCustomTab);
router.put('/:categoryId/custom-tabs/:tabId', authenticate, requireAdmin, categoryPageContentController.updateCustomTab);
router.delete('/:categoryId/custom-tabs/:tabId', authenticate, requireAdmin, categoryPageContentController.deleteCustomTab);
router.post('/:categoryId/custom-tabs/reorder', authenticate, requireAdmin, categoryPageContentController.reorderCustomTabs);

router.post('/:categoryId/media', authenticate, requireAdmin, upload.single('file'), categoryPageContentController.uploadMedia);

router.put('/:categoryId/seo', authenticate, requireAdmin, categoryPageContentController.updateSEO);

router.post('/:categoryId/revisions', authenticate, requireAdmin, categoryPageContentController.createRevision);

module.exports = router;
