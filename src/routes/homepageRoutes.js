const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { upload } = require('../utils/fileUpload');
const homepageController = require('../controllers/homepageController');

router.get('/hero/:slug?', homepageController.getHero);
router.put('/hero', authenticate, requireAdmin, homepageController.upsertHero);
router.post(
  '/hero/media',
  authenticate,
  requireAdmin,
  upload.single('file'),
  homepageController.uploadHeroMedia
);

module.exports = router;
