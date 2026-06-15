const logger = require('../config/logger');
const { redisCache } = require('../utils/redisCache');

// Clears every cache entry owned by the application (Redis keys prefixed with
// "bharat_mock:" plus the in-memory fallback store). Admin-only.
const clearCache = async (req, res) => {
  try {
    const removed = await redisCache.flushAll();
    logger.info(`Application cache cleared by user ${req.user?.id || 'unknown'} — ${removed} Redis keys removed`);
    return res.json({
      success: true,
      message: 'Application cache cleared successfully',
      data: { keysRemoved: removed },
    });
  } catch (error) {
    logger.error('Failed to clear application cache', error);
    return res.status(500).json({ success: false, message: 'Failed to clear application cache' });
  }
};

module.exports = { clearCache };
