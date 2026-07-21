const prisma = require('../config/prisma');
const logger = require('../config/logger');

const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // If the token already carries admin role, skip DB lookup
    if (req.user.role && req.user.role.toLowerCase() === 'admin') {
      return next();
    }

    const user = await prisma.users.findUnique({
      where: { id: req.user.id },
      select: { role: true },
    });

    if (!user) {
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

const requireAdminOrEditor = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const tokenRole = req.user.role?.toLowerCase();
    if (tokenRole === 'admin' || tokenRole === 'editor') {
      return next();
    }

    const user = await prisma.users.findUnique({
      where: { id: req.user.id },
      select: { role: true },
    });

    if (!user) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const dbRole = user.role?.toLowerCase();
    if (dbRole !== 'admin' && dbRole !== 'editor') {
      logger.warn(`Unauthorized admin access attempt by user: ${req.user.id}`);
      return res.status(403).json({
        success: false,
        message: 'Admin or editor access required'
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

module.exports = { requireAdmin, requireAdminOrEditor };
