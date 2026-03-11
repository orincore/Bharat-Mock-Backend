const supabase = require('../config/database');

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

    const { error } = await supabase.from('activity_logs').insert(payload);
    if (error) {
      console.error('Failed to log activity:', error);
    }
  } catch (error) {
    console.error('Failed to log activity:', error);
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

    let query = supabase
      .from('activity_logs')
      .select(
        `id,
        user_id,
        user_email,
        user_role,
        user_avatar_url,
        action,
        resource_type,
        resource_id,
        details,
        ip_address,
        user_agent,
        created_at`,
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNumber - 1);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    if (action) {
      query = query.eq('action', action);
    }

    if (resourceType) {
      query = query.eq('resource_type', resourceType);
    }

    if (startDate) {
      query = query.gte('created_at', startDate);
    }

    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

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

    const { data, error } = await supabase
      .from('activity_logs')
      .select(
        `id,
        user_id,
        user_email,
        user_role,
        user_avatar_url,
        action,
        resource_type,
        resource_id,
        details,
        created_at`
      )
      .order('created_at', { ascending: false })
      .limit(limitNumber);

    if (error) {
      throw error;
    }

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
    const [{ data: statsData, error: statsError }, { data: topActionsData, error: topError }] = await Promise.all([
      supabase.rpc('get_activity_log_stats'),
      supabase.rpc('get_activity_log_top_actions', { limit_count: 10 })
    ]);

    if (statsError) throw statsError;
    if (topError) throw topError;

    res.json({
      success: true,
      stats: statsData?.[0] || {
        total_activities: 0,
        active_users: 0,
        last_24h: 0,
        last_7d: 0,
        last_30d: 0
      },
      topActions: topActionsData || []
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
    const { error } = await supabase.rpc('delete_old_activity_logs');

    if (error) {
      throw error;
    }

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
