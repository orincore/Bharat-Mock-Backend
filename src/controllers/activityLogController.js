const prisma = require('../config/prisma');

const logActivity = async ({
  userId,
  userEmail,
  userRole,
  action,
  resourceType = null,
  resourceId = null,
  details = {},
  ipAddress = null,
  userAgent = null
}) => {
  try {
    const payload = {
      user_id: userId,
      user_email: userEmail,
      user_role: userRole,
      user_avatar_url: details?.userAvatarUrl || null,
      action,
      resource_type: resourceType,
      resource_id: resourceId?.toString?.() ?? resourceId,
      details: (details && typeof details === 'object' ? { ...details, userAvatarUrl: undefined } : {}) || {},
      ip_address: ipAddress,
      user_agent: userAgent
    };

    await prisma.activity_logs.create({ data: payload });
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
};

// Fast approximate row count via planner statistics (pg_class.reltuples), instead of
// an exact COUNT(*) full-table-visit. Used only for the unfiltered activity_logs list
// view — the common case when the admin panel opens with no filters applied — where an
// approximate total (for "X results" / page-count display) is an acceptable trade for
// avoiding a scan that gets linearly slower as the table grows. Falls back to an exact
// count if statistics aren't available yet (e.g. immediately after table creation,
// before the first autoanalyze), which is the same edge case already handled for
// get_activity_log_stats() in migrations/20260720_estimate_activity_log_total.sql.
const getEstimatedActivityLogCount = async () => {
  try {
    const result = await prisma.$queryRaw`
      SELECT reltuples::BIGINT AS estimate FROM pg_class WHERE relname = 'activity_logs'
    `;
    const estimate = result?.[0]?.estimate != null ? Number(result[0].estimate) : null;
    if (estimate === null || estimate <= 0) {
      return prisma.activity_logs.count();
    }
    return estimate;
  } catch (error) {
    console.error('Failed to get estimated activity_logs count, falling back to exact count:', error);
    return prisma.activity_logs.count();
  }
};

const getActivityLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      userId,
      action,
      resourceType,
      startDate,
      endDate
    } = req.query;

    const pageNumber = parseInt(page, 10) || 1;
    const limitNumber = parseInt(limit, 10) || 50;
    const offset = (pageNumber - 1) * limitNumber;

    const where = {};
    if (userId) where.user_id = userId;
    if (action) where.action = action;
    if (resourceType) where.resource_type = resourceType;
    if (startDate || endDate) {
      where.created_at = {};
      if (startDate) where.created_at.gte = new Date(startDate);
      if (endDate) where.created_at.lte = new Date(endDate);
    }

    // Filtered queries are already bounded by existing indexes (action, created_at,
    // resource_type+resource_id, user_id) so an exact count stays cheap; only the
    // unfiltered case benefits from (and needs) the estimate.
    const hasFilters = Object.keys(where).length > 0;

    const [data, count] = await Promise.all([
      prisma.activity_logs.findMany({
        where,
        select: {
          id: true, user_id: true, user_email: true, user_role: true, user_avatar_url: true,
          action: true, resource_type: true, resource_id: true, details: true, ip_address: true,
          user_agent: true, created_at: true,
        },
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limitNumber,
      }),
      hasFilters ? prisma.activity_logs.count({ where }) : getEstimatedActivityLogCount(),
    ]);

    res.json({
      success: true,
      logs: data || [],
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limitNumber)
      }
    });
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activity logs'
    });
  }
};

const getRecentActivity = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const limitNumber = parseInt(limit, 10) || 10;

    const data = await prisma.activity_logs.findMany({
      select: {
        id: true, user_id: true, user_email: true, user_role: true, user_avatar_url: true,
        action: true, resource_type: true, resource_id: true, details: true, created_at: true,
      },
      orderBy: { created_at: 'desc' },
      take: limitNumber,
    });

    res.json({
      success: true,
      logs: data || []
    });
  } catch (error) {
    console.error('Error fetching recent activity:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recent activity'
    });
  }
};

const getActivityStats = async (req, res) => {
  try {
    const [statsData, topActionsData] = await Promise.all([
      prisma.$queryRaw`SELECT * FROM get_activity_log_stats()`,
      prisma.$queryRaw`SELECT * FROM get_activity_log_top_actions(${10})`,
    ]);

    // Postgres BIGINT columns come back from $queryRaw as JS BigInt, which
    // JSON.stringify/res.json cannot serialize — convert to plain numbers.
    const rawStats = statsData?.[0];
    const stats = rawStats
      ? {
          total_activities: Number(rawStats.total_activities),
          active_users: Number(rawStats.active_users),
          last_24h: Number(rawStats.last_24h),
          last_7d: Number(rawStats.last_7d),
          last_30d: Number(rawStats.last_30d),
        }
      : {
          total_activities: 0,
          active_users: 0,
          last_24h: 0,
          last_7d: 0,
          last_30d: 0
        };

    res.json({
      success: true,
      stats,
      topActions: (topActionsData || []).map(row => ({ ...row, action_count: Number(row.action_count) }))
    });
  } catch (error) {
    console.error('Error fetching activity stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activity stats'
    });
  }
};

const manualCleanup = async (req, res) => {
  try {
    await prisma.$executeRaw`SELECT delete_old_activity_logs()`;

    res.json({
      success: true,
      message: 'Old activity logs cleaned up successfully'
    });
  } catch (error) {
    console.error('Error cleaning up logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup logs'
    });
  }
};

module.exports = {
  logActivity,
  getActivityLogs,
  getRecentActivity,
  getActivityStats,
  manualCleanup
};
