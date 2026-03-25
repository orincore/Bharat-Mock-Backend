const logger = require('../config/logger');

// Performance monitoring middleware
const performanceMonitor = (req, res, next) => {
  const startTime = Date.now();
  const startMemory = process.memoryUsage();

  // Override res.json to capture response time
  const originalJson = res.json;
  res.json = function(data) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    const endMemory = process.memoryUsage();
    
    // Log slow requests
    const slowQueryThreshold = parseInt(process.env.SLOW_QUERY_THRESHOLD) || 1000;
    if (duration > slowQueryThreshold) {
      logger.warn('Slow request detected', {
        method: req.method,
        url: req.originalUrl,
        duration: `${duration}ms`,
        memoryDelta: {
          rss: `${(endMemory.rss - startMemory.rss) / 1024 / 1024}MB`,
          heapUsed: `${(endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024}MB`,
        },
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
    }

    // Add performance headers
    res.set({
      'X-Response-Time': `${duration}ms`,
      'X-Memory-Usage': `${Math.round(endMemory.heapUsed / 1024 / 1024)}MB`
    });

    return originalJson.call(this, data);
  };

  next();
};

// Database query performance tracker
const queryPerformanceTracker = {
  trackQuery: (queryName, startTime) => {
    const duration = Date.now() - startTime;
    const slowQueryThreshold = parseInt(process.env.SLOW_QUERY_THRESHOLD) || 1000;
    
    if (duration > slowQueryThreshold) {
      logger.warn('Slow database query', {
        queryName,
        duration: `${duration}ms`
      });
    }

    return duration;
  }
};

// Memory usage monitor
const memoryMonitor = () => {
  const usage = process.memoryUsage();
  const formatMemory = (bytes) => Math.round(bytes / 1024 / 1024);
  
  logger.info('Memory usage', {
    rss: `${formatMemory(usage.rss)}MB`,
    heapTotal: `${formatMemory(usage.heapTotal)}MB`,
    heapUsed: `${formatMemory(usage.heapUsed)}MB`,
    external: `${formatMemory(usage.external)}MB`,
    arrayBuffers: `${formatMemory(usage.arrayBuffers)}MB`
  });
};

// Start memory monitoring if enabled
if (process.env.ENABLE_PERFORMANCE_METRICS === 'true') {
  setInterval(memoryMonitor, 60000); // Every minute
}

module.exports = {
  performanceMonitor,
  queryPerformanceTracker,
  memoryMonitor
};