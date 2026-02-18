const express = require('express');
const router = express.Router();
const subscriptionPageController = require('../controllers/subscriptionPageController');
const { authenticate: authenticateToken } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { upload } = require('../utils/fileUpload');

router.get('/content', subscriptionPageController.getPageContent);

router.put('/sections/:id', authenticateToken, requireAdmin, subscriptionPageController.updateSection);
router.post('/sections', authenticateToken, requireAdmin, subscriptionPageController.createSection);
router.delete('/sections/:id', authenticateToken, requireAdmin, subscriptionPageController.deleteSection);

router.put('/blocks/:id', authenticateToken, requireAdmin, subscriptionPageController.updateBlock);
router.post('/blocks', authenticateToken, requireAdmin, subscriptionPageController.createBlock);
router.delete('/blocks/:id', authenticateToken, requireAdmin, subscriptionPageController.deleteBlock);

router.put('/meta', authenticateToken, requireAdmin, subscriptionPageController.updateMeta);
router.post('/media', authenticateToken, requireAdmin, upload.single('file'), subscriptionPageController.uploadMedia);

module.exports = router;
