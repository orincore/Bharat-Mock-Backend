const jwt = require('jsonwebtoken');
const supabase = require('../config/database');
const logger = require('../config/logger');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication token required' 
      });
    }

    const token = authHeader.substring(7);
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, avatar_url, is_blocked, is_verified, is_onboarded, auth_provider')
      .eq('id', decoded.userId)
      .is('deleted_at', null)
      .single();

    if (error || !user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid or expired token' 
      });
    }

    if (user.is_blocked) {
      return res.status(403).json({ 
        success: false, 
        message: 'Your account has been blocked' 
      });
    }

    req.user = user;
    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token' 
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Token expired' 
      });
    }
    
    return res.status(500).json({ 
      success: false, 
      message: 'Authentication failed' 
    });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const { data: user } = await supabase
      .from('users')
      .select('id, email, name, avatar_url')
      .eq('id', decoded.userId)
      .is('deleted_at', null)
      .single();

    req.user = user || null;
    next();
  } catch (error) {
    req.user = null;
    next();
  }
};

const adminAuth = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    const { data: adminUser, error } = await supabase
      .from('admin_users')
      .select(`
        id,
        is_active,
        admin_roles (
          name,
          description
        )
      `)
      .eq('user_id', req.user.id)
      .eq('is_active', true)
      .single();

    if (error || !adminUser) {
      return res.status(403).json({ 
        success: false, 
        message: 'Admin access required' 
      });
    }

    req.adminUser = adminUser;
    req.adminRole = adminUser.admin_roles.name;
    next();
  } catch (error) {
    logger.error('Admin authentication error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Admin authentication failed' 
    });
  }
};

const checkPermission = (resource, action) => {
  return async (req, res, next) => {
    try {
      if (req.adminRole === 'admin') {
        return next();
      }

      const { data: permission } = await supabase
        .from('admin_permissions')
        .select(`can_${action}`)
        .eq('role_id', req.adminUser.admin_roles.id)
        .eq('resource', resource)
        .single();

      if (!permission || !permission[`can_${action}`]) {
        return res.status(403).json({ 
          success: false, 
          message: 'Insufficient permissions' 
        });
      }

      next();
    } catch (error) {
      logger.error('Permission check error:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Permission check failed' 
      });
    }
  };
};

module.exports = {
  authenticate,
  optionalAuth,
  adminAuth,
  checkPermission
};
