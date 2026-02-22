const express = require('express');
const router = express.Router();
const { authenticate, adminAuth } = require('../middleware/auth');
const { upload } = require('../utils/fileUpload');
const {
  getPublicBanners,
  getAdminBanners,
  createBanner,
  updateBanner,
  deleteBanner,
  reorderBanners,
  uploadBannerImage
} = require('../controllers/pageBannersController');

router.get('/admin/:pageIdentifier', authenticate, adminAuth, getAdminBanners);

router.post('/', authenticate, adminAuth, createBanner);

router.put('/:id', authenticate, adminAuth, updateBanner);

router.delete('/:id', authenticate, adminAuth, deleteBanner);

router.post('/reorder', authenticate, adminAuth, reorderBanners);

router.post(
  '/upload',
  authenticate,
  adminAuth,
  upload.single('file'),
  uploadBannerImage
);

router.get('/:pageIdentifier', getPublicBanners);

module.exports = router;
