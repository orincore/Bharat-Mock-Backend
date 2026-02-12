const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { upload } = require('../utils/fileUpload');
const homepageController = require('../controllers/homepageController');

router.get('/data', homepageController.getHomepageData);
router.get('/hero/:slug?', homepageController.getHero);
router.put('/hero', authenticate, requireAdmin, homepageController.upsertHero);
router.post(
  '/hero/media',
  authenticate,
  requireAdmin,
  upload.single('file'),
  homepageController.uploadHeroMedia
);

router.get('/banners', homepageController.getBanners);
router.post('/banners', authenticate, requireAdmin, homepageController.createBanner);
router.put('/banners/:id', authenticate, requireAdmin, homepageController.updateBanner);
router.delete('/banners/:id', authenticate, requireAdmin, homepageController.deleteBanner);
router.post('/banners/reorder', authenticate, requireAdmin, homepageController.reorderBanners);
router.post(
  '/banners/upload',
  authenticate,
  requireAdmin,
  upload.single('file'),
  homepageController.uploadBannerImage
);

module.exports = router;
