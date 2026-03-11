const express = require('express');
const router = express.Router();
const blogController = require('../controllers/blogController');
const { authenticate, optionalAuth, adminAuth, checkPermission, requireRole } = require('../middleware/auth');
const activityLogger = require('../middleware/activityLogger');
const { upload } = require('../utils/fileUpload');

// Public routes (with optional auth so admins see drafts)
router.get('/', optionalAuth, blogController.getBlogs);
router.get('/categories', optionalAuth, blogController.getBlogCategories);

// Admin routes
router.get('/admin/list', authenticate, adminAuth, checkPermission('blogs', 'read'), blogController.getBlogs);
router.get('/admin/categories', authenticate, adminAuth, checkPermission('blogs', 'read'), blogController.getBlogCategories);
router.get('/id/:blogId', authenticate, adminAuth, checkPermission('blogs', 'read'), blogController.getBlogById);
router.get('/admin/:blogId/content', authenticate, adminAuth, checkPermission('blogs', 'read'), blogController.getBlogContent);
router.get('/:blogId/content', optionalAuth, blogController.getBlogContent);
router.post('/', authenticate, adminAuth, checkPermission('blogs', 'create'), activityLogger('CREATE_BLOG', 'blog'), blogController.createBlog);
router.put('/:blogId', authenticate, adminAuth, checkPermission('blogs', 'update'), activityLogger('UPDATE_BLOG', 'blog'), blogController.updateBlog);
router.delete('/:blogId', authenticate, adminAuth, requireRole('admin'), activityLogger('DELETE_BLOG', 'blog'), blogController.deleteBlog);
router.post('/:blogId/bulk-sync', authenticate, adminAuth, checkPermission('blogs', 'update'), activityLogger('SYNC_BLOG_CONTENT', 'blog'), blogController.bulkSyncBlogContent);
router.post('/:blogId/media', authenticate, adminAuth, checkPermission('blogs', 'update'), activityLogger('UPLOAD_BLOG_MEDIA', 'blog'), upload.single('file'), blogController.uploadMedia);

// Public slug route must come last to avoid catching admin paths
router.get('/:slug', blogController.getBlogBySlug);

module.exports = router;
