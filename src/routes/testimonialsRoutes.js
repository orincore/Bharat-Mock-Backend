const express = require('express');
const { optionalAuth, authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { upload } = require('../utils/fileUpload');
const {
  getPublicTestimonials,
  getAllTestimonialsAdmin,
  adminCreateTestimonial,
  adminUpdateTestimonial,
  adminDeleteTestimonial
} = require('../controllers/testimonialsController');

const router = express.Router();

router.get('/', optionalAuth, getPublicTestimonials);
router.get('/admin/list', authenticate, requireAdmin, getAllTestimonialsAdmin);
router.post('/admin', authenticate, requireAdmin, upload.single('profilePhoto'), adminCreateTestimonial);
router.put('/admin/:id', authenticate, requireAdmin, upload.single('profilePhoto'), adminUpdateTestimonial);
router.delete('/admin/:id', authenticate, requireAdmin, adminDeleteTestimonial);

module.exports = router;
