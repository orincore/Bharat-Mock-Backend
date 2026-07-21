const { logActivity } = require('../controllers/activityLogController');

// Hard cap on how much any single request body field (and the body as a whole) can
// contribute to a logged activity_logs row. Admin write endpoints that accept full
// nested content — bulk exam create/update (exam + every section/question/option),
// draft saves, page-content bulk-sync, etc — were logging the ENTIRE raw request body
// verbatim into `details.body` on every single call. That's how a table meant to hold
// lightweight audit entries ("who did what, when") ended up averaging ~370KB/row
// (1.6GB for ~4,400 rows) and slowing down every list/count query against it. Capping
// what gets written here fixes the problem at the source — every future insert stays
// small, so the table (and the indexes/queries over it) stay fast as it grows.
const MAX_FIELD_CHARS = 2000; // per top-level field, after which it's summarized instead of stored in full
const MAX_BODY_CHARS = 8000;  // hard ceiling on the whole sanitized body once summarized

const summarizeValue = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_FIELD_CHARS
      ? `[string, ${value.length} chars, truncated] ${value.slice(0, 200)}…`
      : value;
  }
  if (Array.isArray(value)) {
    const asString = JSON.stringify(value);
    return asString.length > MAX_FIELD_CHARS
      ? `[array, ${value.length} items, ${asString.length} chars, omitted]`
      : value;
  }
  if (typeof value === 'object') {
    const asString = JSON.stringify(value);
    return asString.length > MAX_FIELD_CHARS
      ? `[object, ${Object.keys(value).length} keys, ${asString.length} chars, omitted]`
      : value;
  }
  return value;
};

const sanitizeBody = (body) => {
  if (!body || typeof body !== 'object') return {};

  const sensitiveFields = ['password', 'token', 'secret', 'apiKey'];

  const summarized = {};
  for (const [key, rawValue] of Object.entries(body)) {
    if (sensitiveFields.includes(key)) {
      summarized[key] = '[REDACTED]';
      continue;
    }
    summarized[key] = summarizeValue(rawValue);
  }

  // Belt-and-braces: even after per-field summarization, a body with many
  // moderately-sized fields could still add up past a sane total. If so, keep just
  // the field names + sizes rather than any content at all.
  const finalString = JSON.stringify(summarized);
  if (finalString.length > MAX_BODY_CHARS) {
    const fieldSizes = {};
    for (const [key, rawValue] of Object.entries(body)) {
      fieldSizes[key] = sensitiveFields.includes(key)
        ? '[REDACTED]'
        : `${JSON.stringify(rawValue ?? null).length} chars`;
    }
    return { _truncated: true, totalChars: finalString.length, fieldSizes };
  }

  return summarized;
};

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

module.exports = activityLogger;
