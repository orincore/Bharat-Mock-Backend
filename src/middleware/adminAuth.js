const supabase = require('../config/database');
const logger = require('../config/logger');

const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (error || !user) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (user.role !== 'admin') {
      logger.warn(`Unauthorized admin access attempt by user: ${req.user.id}`);
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    next();
  } catch (error) {
    logger.error('Admin auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during authorization'
    });
  }
};

module.exports = { requireAdmin };
