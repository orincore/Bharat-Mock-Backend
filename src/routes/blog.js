const express = require('express');
const router = express.Router();
const blogController = require('../controllers/blogController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { upload } = require('../utils/fileUpload');

// Public routes
router.get('/', blogController.getBlogs);
router.get('/:slug', blogController.getBlogBySlug);
router.get('/:blogId/content', blogController.getBlogContent);

// Admin routes
router.post('/', authenticate, requireAdmin, blogController.createBlog);
router.put('/:blogId', authenticate, requireAdmin, blogController.updateBlog);
router.delete('/:blogId', authenticate, requireAdmin, blogController.deleteBlog);
router.post('/:blogId/bulk-sync', authenticate, requireAdmin, blogController.bulkSyncBlogContent);
router.post('/:blogId/media', authenticate, requireAdmin, upload.single('file'), blogController.uploadMedia);

module.exports = router;
