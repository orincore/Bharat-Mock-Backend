const { logActivity } = require('../controllers/activityLogController');

const activityLogger = (action, resourceType = null) => {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);
    
    res.json = function(data) {
      if (req.user && ['admin', 'editor', 'author'].includes(req.user.role)) {
        const resourceId = req.params.id || req.params.examId || req.params.userId || 
                          req.params.blogId || req.params.categoryId || req.params.subcategoryId || 
                          data?.id || data?.exam?.id || null;
        
        const details = {
          method: req.method,
          path: req.path,
          body: sanitizeBody(req.body),
          params: req.params,
          query: req.query,
          success: data?.success !== false,
          userAvatarUrl: req.user.avatar_url || null
        };

        logActivity({
          userId: req.user.id,
          userEmail: req.user.email,
          userRole: req.user.role,
          action,
          resourceType,
          resourceId,
          details,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent')
        }).catch(err => console.error('Activity logging failed:', err));
      }
      
      return originalJson(data);
    };
    
    next();
  };
};

const sanitizeBody = (body) => {
  if (!body) return {};
  
  const sanitized = { ...body };
  
  const sensitiveFields = ['password', 'token', 'secret', 'apiKey'];
  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  });
  
  return sanitized;
};

module.exports = activityLogger;
