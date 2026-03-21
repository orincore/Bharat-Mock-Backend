const express = require('express');
const router = express.Router();
const pageContentController = require('../controllers/pageContentController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requireAdminOrEditor } = require('../middleware/adminAuth');
const { upload } = require('../utils/fileUpload');

router.get('/:subcategoryId', pageContentController.getPageContent);

router.post('/:subcategoryId/sections', authenticate, requireAdminOrEditor, pageContentController.createSection);
router.put('/sections/:sectionId', authenticate, requireAdminOrEditor, pageContentController.updateSection);
router.delete('/sections/:sectionId', authenticate, requireAdminOrEditor, pageContentController.deleteSection);
router.put('/:subcategoryId/sections/sync', authenticate, requireAdminOrEditor, pageContentController.syncSections);

router.post('/:subcategoryId/blocks', authenticate, requireAdminOrEditor, pageContentController.createBlock);
router.put('/blocks/:blockId', authenticate, requireAdminOrEditor, pageContentController.updateBlock);
router.delete('/blocks/:blockId', authenticate, requireAdminOrEditor, pageContentController.deleteBlock);
router.post('/blocks/reorder', authenticate, requireAdminOrEditor, pageContentController.reorderBlocks);
router.post('/:subcategoryId/bulk-sync', authenticate, requireAdminOrEditor, pageContentController.bulkSyncPageContent);

router.get('/:subcategoryId/custom-tabs', pageContentController.getCustomTabs);
router.post('/:subcategoryId/custom-tabs', authenticate, requireAdminOrEditor, pageContentController.createCustomTab);
router.put('/:subcategoryId/custom-tabs/:tabId', authenticate, requireAdminOrEditor, pageContentController.updateCustomTab);
router.delete('/:subcategoryId/custom-tabs/:tabId', authenticate, requireAdminOrEditor, pageContentController.deleteCustomTab);
router.post('/:subcategoryId/custom-tabs/reorder', authenticate, requireAdminOrEditor, pageContentController.reorderCustomTabs);

router.get('/:subcategoryId/tab-config', pageContentController.getTabConfig);
router.post('/:subcategoryId/tab-config', authenticate, requireAdminOrEditor, pageContentController.createTabConfig);
router.put('/:subcategoryId/tab-config/:tabConfigId', authenticate, requireAdminOrEditor, pageContentController.updateTabConfig);
router.delete('/:subcategoryId/tab-config/:tabConfigId', authenticate, requireAdminOrEditor, pageContentController.deleteTabConfig);
router.post('/:subcategoryId/tab-config/reorder', authenticate, requireAdminOrEditor, pageContentController.reorderTabConfig);
router.post('/:subcategoryId/tab-config/initialize', authenticate, requireAdminOrEditor, pageContentController.initializeDefaultTabs);

router.post('/:subcategoryId/media', authenticate, requireAdminOrEditor, upload.single('file'), pageContentController.uploadMedia);
router.get('/:subcategoryId/media', pageContentController.getMedia);

router.put('/:subcategoryId/seo', authenticate, requireAdminOrEditor, pageContentController.updateSEO);

router.post('/:subcategoryId/revisions', authenticate, requireAdminOrEditor, pageContentController.createRevision);
router.get('/:subcategoryId/revisions', authenticate, requireAdminOrEditor, pageContentController.getRevisions);
router.post('/:subcategoryId/revisions/:revisionId/restore', authenticate, requireAdminOrEditor, pageContentController.restoreRevision);

module.exports = router;
