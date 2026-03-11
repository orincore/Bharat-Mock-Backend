const express = require('express');
const router = express.Router();
const { authenticate, adminAuth } = require('../middleware/auth');
const activityLogController = require('../controllers/activityLogController');

router.get('/logs', authenticate, adminAuth, activityLogController.getActivityLogs);

router.get('/logs/recent', authenticate, adminAuth, activityLogController.getRecentActivity);

router.get('/logs/stats', authenticate, adminAuth, activityLogController.getActivityStats);

router.post('/logs/cleanup', authenticate, adminAuth, activityLogController.manualCleanup);

module.exports = router;
