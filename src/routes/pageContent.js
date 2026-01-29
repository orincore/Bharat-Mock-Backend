const express = require('express');
const router = express.Router();
const pageContentController = require('../controllers/pageContentController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');

router.get('/:subcategoryId', pageContentController.getPageContent);

router.post('/:subcategoryId/sections', authenticate, requireAdmin, pageContentController.createSection);
router.put('/sections/:sectionId', authenticate, requireAdmin, pageContentController.updateSection);
router.delete('/sections/:sectionId', authenticate, requireAdmin, pageContentController.deleteSection);

router.post('/:subcategoryId/blocks', authenticate, requireAdmin, pageContentController.createBlock);
router.put('/blocks/:blockId', authenticate, requireAdmin, pageContentController.updateBlock);
router.delete('/blocks/:blockId', authenticate, requireAdmin, pageContentController.deleteBlock);
router.post('/blocks/reorder', authenticate, requireAdmin, pageContentController.reorderBlocks);
router.post('/:subcategoryId/bulk-sync', authenticate, requireAdmin, pageContentController.bulkSyncPageContent);

router.post('/:subcategoryId/media', authenticate, requireAdmin, pageContentController.uploadMedia);
router.get('/:subcategoryId/media', pageContentController.getMedia);

router.put('/:subcategoryId/seo', authenticate, requireAdmin, pageContentController.updateSEO);

router.post('/:subcategoryId/revisions', authenticate, requireAdmin, pageContentController.createRevision);
router.get('/:subcategoryId/revisions', authenticate, requireAdmin, pageContentController.getRevisions);
router.post('/:subcategoryId/revisions/:revisionId/restore', authenticate, requireAdmin, pageContentController.restoreRevision);

module.exports = router;
