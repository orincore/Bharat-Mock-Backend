const express = require('express');
const router = express.Router();
const pageContentController = require('../controllers/pageContentController');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { requireAdmin, requireAdminOrEditor } = require('../middleware/adminAuth');
const { upload } = require('../utils/fileUpload');

router.get('/:subcategoryId', optionalAuth, pageContentController.getPageContent);

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

// Repair endpoint: fixes blocks where subcategory_id was nulled by upsert bug
router.post('/:subcategoryId/repair-blocks', authenticate, requireAdminOrEditor, async (req, res) => {
  const supabase = require('../config/database');
  const { subcategoryId } = req.params;
  try {
    // Get all sections for this subcategory
    const { data: sections } = await supabase
      .from('page_sections')
      .select('id')
      .eq('subcategory_id', subcategoryId);

    if (!sections?.length) return res.json({ success: true, fixed: 0 });

    const sectionIds = sections.map(s => s.id);

    // Find blocks belonging to these sections but with wrong/null subcategory_id
    const { data: brokenBlocks } = await supabase
      .from('page_content_blocks')
      .select('id')
      .in('section_id', sectionIds)
      .neq('subcategory_id', subcategoryId);

    if (!brokenBlocks?.length) return res.json({ success: true, fixed: 0 });

    const { error } = await supabase
      .from('page_content_blocks')
      .update({ subcategory_id: subcategoryId })
      .in('id', brokenBlocks.map(b => b.id));

    if (error) return res.status(500).json({ success: false, message: error.message });

    res.json({ success: true, fixed: brokenBlocks.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
