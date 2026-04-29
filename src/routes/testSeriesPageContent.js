const express = require('express');
const router = express.Router();
const testSeriesPageContentController = require('../controllers/testSeriesPageContentController');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { requireAdminOrEditor } = require('../middleware/adminAuth');
const { upload } = require('../utils/fileUpload');

router.get('/:testSeriesId', optionalAuth, testSeriesPageContentController.getPageContent);

router.post('/:testSeriesId/bulk-sync', authenticate, requireAdminOrEditor, testSeriesPageContentController.bulkSyncPageContent);

router.get('/:testSeriesId/custom-tabs', testSeriesPageContentController.getCustomTabs);
router.post('/:testSeriesId/custom-tabs', authenticate, requireAdminOrEditor, testSeriesPageContentController.createCustomTab);
router.put('/:testSeriesId/custom-tabs/:tabId', authenticate, requireAdminOrEditor, testSeriesPageContentController.updateCustomTab);
router.delete('/:testSeriesId/custom-tabs/:tabId', authenticate, requireAdminOrEditor, testSeriesPageContentController.deleteCustomTab);
router.post('/:testSeriesId/custom-tabs/reorder', authenticate, requireAdminOrEditor, testSeriesPageContentController.reorderCustomTabs);

router.post('/:testSeriesId/media', authenticate, requireAdminOrEditor, upload.single('file'), testSeriesPageContentController.uploadMedia);

router.put('/:testSeriesId/seo', authenticate, requireAdminOrEditor, testSeriesPageContentController.updateSEO);

router.post('/:testSeriesId/revisions', authenticate, requireAdminOrEditor, testSeriesPageContentController.createRevision);

module.exports = router;
