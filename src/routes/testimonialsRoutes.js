const express = require('express');
const router = express.Router();

const { authenticate, optionalAuth, adminAuth } = require('../middleware/auth');
const {
  getPublicTestimonials,
  getMyTestimonial,
  createTestimonial,
  updateOwnTestimonial,
  deleteOwnTestimonial,
  getAllTestimonialsAdmin,
  adminUpdateTestimonial
} = require('../controllers/testimonialsController');

router.get('/', optionalAuth, getPublicTestimonials);
router.get('/me', authenticate, getMyTestimonial);
router.post('/', authenticate, createTestimonial);
router.put('/:id', authenticate, updateOwnTestimonial);
router.delete('/:id', authenticate, deleteOwnTestimonial);

router.get('/admin/list', authenticate, adminAuth, getAllTestimonialsAdmin);
router.patch('/admin/:id', authenticate, adminAuth, adminUpdateTestimonial);

module.exports = router;
