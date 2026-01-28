const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { upload } = require('../utils/fileUpload');
const subcategoryContentController = require('../controllers/subcategoryContentController');

router.get('/:subcategoryId/overview', subcategoryContentController.getOverview);
router.post('/:subcategoryId/overview', authenticate, subcategoryContentController.upsertOverview);
router.put('/:subcategoryId/overview', authenticate, subcategoryContentController.upsertOverview);
router.post(
  '/:subcategoryId/overview/hero-image',
  authenticate,
  upload.single('image'),
  subcategoryContentController.uploadHeroImage
);

router.get('/:subcategoryId/updates', subcategoryContentController.getUpdates);
router.post('/:subcategoryId/updates', authenticate, subcategoryContentController.upsertUpdate);
router.put('/:subcategoryId/updates/:updateId', authenticate, subcategoryContentController.upsertUpdate);
router.delete('/:subcategoryId/updates/:updateId', authenticate, subcategoryContentController.deleteUpdate);

router.get('/:subcategoryId/highlights', subcategoryContentController.getHighlights);
router.post('/:subcategoryId/highlights', authenticate, subcategoryContentController.upsertHighlight);
router.put('/:subcategoryId/highlights/:highlightId', authenticate, subcategoryContentController.upsertHighlight);
router.delete('/:subcategoryId/highlights/:highlightId', authenticate, subcategoryContentController.deleteHighlight);

router.get('/:subcategoryId/exam-stats', subcategoryContentController.getExamStats);
router.post('/:subcategoryId/exam-stats', authenticate, subcategoryContentController.upsertExamStat);
router.put('/:subcategoryId/exam-stats/:statId', authenticate, subcategoryContentController.upsertExamStat);
router.delete('/:subcategoryId/exam-stats/:statId', authenticate, subcategoryContentController.deleteExamStat);

router.get('/:subcategoryId/sections', subcategoryContentController.getSections);
router.post('/:subcategoryId/sections', authenticate, subcategoryContentController.upsertSection);
router.put('/:subcategoryId/sections/:sectionId', authenticate, subcategoryContentController.upsertSection);
router.delete('/:subcategoryId/sections/:sectionId', authenticate, subcategoryContentController.deleteSection);

router.get('/:subcategoryId/tables', subcategoryContentController.getTables);
router.post('/:subcategoryId/tables', authenticate, subcategoryContentController.upsertTable);
router.put('/:subcategoryId/tables/:tableId', authenticate, subcategoryContentController.upsertTable);
router.delete('/:subcategoryId/tables/:tableId', authenticate, subcategoryContentController.deleteTable);

router.get('/:subcategoryId/question-papers', subcategoryContentController.getQuestionPapers);
router.post('/:subcategoryId/question-papers', authenticate, subcategoryContentController.upsertQuestionPaper);
router.put('/:subcategoryId/question-papers/:paperId', authenticate, subcategoryContentController.upsertQuestionPaper);
router.delete('/:subcategoryId/question-papers/:paperId', authenticate, subcategoryContentController.deleteQuestionPaper);

router.get('/:subcategoryId/faqs', subcategoryContentController.getFAQs);
router.post('/:subcategoryId/faqs', authenticate, subcategoryContentController.upsertFAQ);
router.put('/:subcategoryId/faqs/:faqId', authenticate, subcategoryContentController.upsertFAQ);
router.delete('/:subcategoryId/faqs/:faqId', authenticate, subcategoryContentController.deleteFAQ);

router.get('/:subcategoryId/resources', subcategoryContentController.getResources);
router.post('/:subcategoryId/resources', authenticate, subcategoryContentController.upsertResource);
router.put('/:subcategoryId/resources/:resourceId', authenticate, subcategoryContentController.upsertResource);
router.delete('/:subcategoryId/resources/:resourceId', authenticate, subcategoryContentController.deleteResource);

module.exports = router;
