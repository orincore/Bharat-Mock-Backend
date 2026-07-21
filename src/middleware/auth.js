const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const logger = require('../config/logger');

// A Google OAuth signup that never finished the "Complete Your Profile" step is
// considered incomplete. is_onboarded is the authoritative flag (set only on
// completion); phone is checked as defense in depth. Scoped to Google users so
// email/password accounts — which never go through onboarding — are unaffected.
const isProfileIncomplete = (user) =>
  !!user &&
  user.auth_provider === 'google' &&
  (!user.is_onboarded || !user.phone);

// Identity endpoints an incomplete user must still reach: read their own profile,
// finish onboarding, change/reset password, refresh token, log out, delete account.
// Everything else is blocked until onboarding is complete.
const isOnboardingExemptPath = (req) => {
  const path = req.originalUrl || req.url || '';
  // All /auth/* routes are identity operations and never expose protected content.
  return path.includes('/auth/');
};

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

    let user = null;
    let dbError = null;
    try {
      user = await prisma.users.findFirst({
        where: { id: decoded.userId, deleted_at: null },
        select: { id: true, email: true, name: true, avatar_url: true, phone: true, is_blocked: true, is_verified: true, is_onboarded: true, auth_provider: true, role: true, token_version: true },
      });
    } catch (err) {
      dbError = err;
    }

    // Session-revocation check: a token whose tv lags the user's current token_version
    // was minted before a password reset/change and is no longer trusted. Only enforced
    // when we have a real DB row (the fallback path below is for resilience when the DB
    // is unreachable and cannot be revoked anyway).
    if (user && (decoded.tv ?? 0) !== (user.token_version ?? 0)) {
      return res.status(401).json({
        success: false,
        code: 'SESSION_REVOKED',
        message: 'Your session has ended. Please sign in again.'
      });
    }

    let resolvedUser = user;

    if (!user || dbError) {
      const fallbackRole = decoded.role || decoded.userRole || decoded.roleName || (decoded.isAdmin ? 'admin' : null);
      resolvedUser = {
        id: decoded.userId,
        email: decoded.email || null,
        name: decoded.name || null,
        avatar_url: decoded.avatar_url || null,
        phone: decoded.phone || null,
        is_blocked: false,
        is_verified: true,
        is_onboarded: true,
        auth_provider: decoded.auth_provider || 'token',
        role: fallbackRole
      };
    }

    if (resolvedUser.is_blocked) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been blocked'
      });
    }

    // Hard server-side onboarding gate. The client redirect alone is bypassable, so
    // we reject every protected request from an incomplete profile here (except the
    // /auth/* identity endpoints needed to actually complete onboarding or log out).
    if (isProfileIncomplete(resolvedUser) && !isOnboardingExemptPath(req)) {
      return res.status(403).json({
        success: false,
        code: 'PROFILE_INCOMPLETE',
        message: 'Please complete your profile before accessing this resource.'
      });
    }

    req.user = resolvedUser;
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

    const user = await prisma.users.findFirst({
      where: { id: decoded.userId, deleted_at: null },
      select: { id: true, email: true, name: true, avatar_url: true, role: true, is_blocked: true },
    });

    let resolvedUser = user || null;

    if (!resolvedUser) {
      const fallbackRole = decoded.role || decoded.userRole || decoded.roleName || (decoded.isAdmin ? 'admin' : null);
      resolvedUser = {
        id: decoded.userId,
        email: decoded.email || null,
        name: decoded.name || null,
        avatar_url: decoded.avatar_url || null,
        role: fallbackRole,
        is_blocked: false
      };
    }

    if (resolvedUser?.is_blocked) {
      req.user = null;
      return next();
    }

    req.user = resolvedUser;
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

    const adminUser = await prisma.admin_users.findFirst({
      where: { user_id: req.user.id, is_active: true },
      select: {
        id: true,
        is_active: true,
        role_id: true,
        admin_roles: { select: { id: true, name: true, description: true } },
      },
    });

    if (!adminUser) {
      console.warn('[adminAuth] adminUser lookup failed', {
        userId: req.user.id,
      });
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    req.adminUser = adminUser;
    req.adminRole = adminUser.admin_roles.name;
    req.roleId = adminUser.admin_roles.id;
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

      let permission;
      try {
        permission = await prisma.admin_permissions.findFirst({
          where: { role_id: req.roleId, resource },
          select: { can_create: true, can_read: true, can_update: true, can_delete: true },
        });
      } catch (error) {
        logger.error('Permission lookup error:', error);
        return res.status(500).json({
          success: false,
          message: 'Permission check failed'
        });
      }

      if (!permission || !permission[`can_${action}`]) {
        return res.status(403).json({ 
          success: false, 
          message: `You do not have permission to ${action} ${resource}` 
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

const requireRole = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      if (!req.adminRole) {
        return res.status(403).json({ 
          success: false, 
          message: 'Admin access required' 
        });
      }

      if (!allowedRoles.includes(req.adminRole)) {
        return res.status(403).json({ 
          success: false, 
          message: `Access denied. Required role: ${allowedRoles.join(' or ')}` 
        });
      }

      next();
    } catch (error) {
      logger.error('Role check error:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Role check failed' 
      });
    }
  };
};

module.exports = {
  authenticate,
  optionalAuth,
  adminAuth,
  checkPermission,
  requireRole
};
