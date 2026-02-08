const express = require('express');
const router = express.Router();
const blogController = require('../controllers/blogController');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { upload } = require('../utils/fileUpload');

// Public routes (with optional auth so admins see drafts)
router.get('/', optionalAuth, blogController.getBlogs);
router.get('/categories', optionalAuth, blogController.getBlogCategories);

// Admin routes
router.get('/admin/list', authenticate, requireAdmin, blogController.getBlogs);
router.get('/admin/categories', authenticate, requireAdmin, blogController.getBlogCategories);
router.get('/id/:blogId', authenticate, requireAdmin, blogController.getBlogById);
router.get('/admin/:blogId/content', authenticate, requireAdmin, blogController.getBlogContent);
router.get('/:blogId/content', optionalAuth, blogController.getBlogContent);
router.post('/', authenticate, requireAdmin, blogController.createBlog);
router.put('/:blogId', authenticate, requireAdmin, blogController.updateBlog);
router.delete('/:blogId', authenticate, requireAdmin, blogController.deleteBlog);
router.post('/:blogId/bulk-sync', authenticate, requireAdmin, blogController.bulkSyncBlogContent);
router.post('/:blogId/media', authenticate, requireAdmin, upload.single('file'), blogController.uploadMedia);

// Public slug route must come last to avoid catching admin paths
router.get('/:slug', blogController.getBlogBySlug);

module.exports = router;
