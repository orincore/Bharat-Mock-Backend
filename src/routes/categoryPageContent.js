const express = require('express');
const router = express.Router();
const categoryPageContentController = require('../controllers/categoryPageContentController');
const { authenticate } = require('../middleware/auth');
const { requireAdminOrEditor } = require('../middleware/adminAuth');
const { upload } = require('../utils/fileUpload');

router.get('/:categoryId', categoryPageContentController.getPageContent);

router.post('/:categoryId/bulk-sync', authenticate, requireAdminOrEditor, categoryPageContentController.bulkSyncPageContent);

router.get('/:categoryId/custom-tabs', categoryPageContentController.getCustomTabs);
router.post('/:categoryId/custom-tabs', authenticate, requireAdminOrEditor, categoryPageContentController.createCustomTab);
router.put('/:categoryId/custom-tabs/:tabId', authenticate, requireAdminOrEditor, categoryPageContentController.updateCustomTab);
router.delete('/:categoryId/custom-tabs/:tabId', authenticate, requireAdminOrEditor, categoryPageContentController.deleteCustomTab);
router.post('/:categoryId/custom-tabs/reorder', authenticate, requireAdminOrEditor, categoryPageContentController.reorderCustomTabs);

router.post('/:categoryId/media', authenticate, requireAdminOrEditor, upload.single('file'), categoryPageContentController.uploadMedia);

router.put('/:categoryId/seo', authenticate, requireAdminOrEditor, categoryPageContentController.updateSEO);

router.post('/:categoryId/revisions', authenticate, requireAdminOrEditor, categoryPageContentController.createRevision);

module.exports = router;
