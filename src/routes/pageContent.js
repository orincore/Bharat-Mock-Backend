const express = require('express');
const router = express.Router();
const pageContentController = require('../controllers/pageContentController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { upload } = require('../utils/fileUpload');

router.get('/:subcategoryId', pageContentController.getPageContent);

router.post('/:subcategoryId/sections', authenticate, requireAdmin, pageContentController.createSection);
router.put('/sections/:sectionId', authenticate, requireAdmin, pageContentController.updateSection);
router.delete('/sections/:sectionId', authenticate, requireAdmin, pageContentController.deleteSection);

router.post('/:subcategoryId/blocks', authenticate, requireAdmin, pageContentController.createBlock);
router.put('/blocks/:blockId', authenticate, requireAdmin, pageContentController.updateBlock);
router.delete('/blocks/:blockId', authenticate, requireAdmin, pageContentController.deleteBlock);
router.post('/blocks/reorder', authenticate, requireAdmin, pageContentController.reorderBlocks);
router.post('/:subcategoryId/bulk-sync', authenticate, requireAdmin, pageContentController.bulkSyncPageContent);

router.get('/:subcategoryId/custom-tabs', pageContentController.getCustomTabs);
router.post('/:subcategoryId/custom-tabs', authenticate, requireAdmin, pageContentController.createCustomTab);
router.put('/:subcategoryId/custom-tabs/:tabId', authenticate, requireAdmin, pageContentController.updateCustomTab);
router.delete('/:subcategoryId/custom-tabs/:tabId', authenticate, requireAdmin, pageContentController.deleteCustomTab);
router.post('/:subcategoryId/custom-tabs/reorder', authenticate, requireAdmin, pageContentController.reorderCustomTabs);

router.get('/:subcategoryId/tab-config', pageContentController.getTabConfig);
router.post('/:subcategoryId/tab-config', authenticate, requireAdmin, pageContentController.createTabConfig);
router.put('/:subcategoryId/tab-config/:tabConfigId', authenticate, requireAdmin, pageContentController.updateTabConfig);
router.delete('/:subcategoryId/tab-config/:tabConfigId', authenticate, requireAdmin, pageContentController.deleteTabConfig);
router.post('/:subcategoryId/tab-config/reorder', authenticate, requireAdmin, pageContentController.reorderTabConfig);
router.post('/:subcategoryId/tab-config/initialize', authenticate, requireAdmin, pageContentController.initializeDefaultTabs);

router.post('/:subcategoryId/media', authenticate, requireAdmin, upload.single('file'), pageContentController.uploadMedia);
router.get('/:subcategoryId/media', pageContentController.getMedia);

router.put('/:subcategoryId/seo', authenticate, requireAdmin, pageContentController.updateSEO);

router.post('/:subcategoryId/revisions', authenticate, requireAdmin, pageContentController.createRevision);
router.get('/:subcategoryId/revisions', authenticate, requireAdmin, pageContentController.getRevisions);
router.post('/:subcategoryId/revisions/:revisionId/restore', authenticate, requireAdmin, pageContentController.restoreRevision);

module.exports = router;
