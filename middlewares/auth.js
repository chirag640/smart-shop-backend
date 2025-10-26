const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { cleanupExpiredOTPs } = require('../utils/otpCleanup');

// Protect routes - verify JWT token
const authMiddleware = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user from token
      req.user = await User.findById(decoded.id).select('-password');

      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'User not found'
        });
      }

      return next(); // Add return here to prevent further execution
    } catch (error) {
      const logger = require('../utils/logger');
      logger.error({ err: error }, 'Token verification failed');
      return res.status(401).json({
        success: false,
        error: 'Not authorized, token failed'
      });
    }
  }
  // This only runs if no authorization header or doesn't start with Bearer
  return res.status(401).json({
    success: false,
    error: 'Not authorized, no token'
  });
};

// Role-based access control
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `User role '${req.user.role}' is not authorized to access this resource`
      });
    }

    next();
  };
};

// Check if user is owner or has staff/admin privileges
const checkOwnerOrStaff = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'User not authenticated'
    });
  }

  // Allow if user is admin, manager, or staff
  if (['admin', 'manager', 'staff'].includes(req.user.role)) {
    return next();
  }

  // For customers, check if they're accessing their own data
  if (req.user.role === 'customer') {
    const userId = req.params.id || req.params.userId || req.body.userId;
    
    if (userId && userId.toString() === req.user._id.toString()) {
      return next();
    }
  }

  return res.status(403).json({
    success: false,
    error: 'Access denied. Insufficient permissions.'
  });
};

// Admin only access
const adminOnly = authorize('admin');

// Manager and above access
const managerAndAbove = authorize('admin', 'manager');

// Staff and above access
const staffAndAbove = authorize('admin', 'manager', 'staff');

// Middleware for on-demand OTP cleanup
const cleanupOTPs = async (req, res, next) => {
  try {
    // Only run cleanup occasionally to avoid performance impact
    const shouldCleanup = Math.random() < 0.1; // 10% chance
    if (shouldCleanup) {
      await cleanupExpiredOTPs();
    }
    next();
  } catch (error) {
    const logger = require('../utils/logger');
    logger.error({ err: error }, 'OTP cleanup failed');
    next(); // Continue even if cleanup fails
  }
};

// Middleware: Only allow staff to create customers during billing
const staffCreateCustomerRestriction = (req, res, next) => {
  if (req.user && req.user.role === 'staff') {
    // Only allow if request comes from billing context (e.g., a special header or query param)
    // You can adjust this logic as needed for your frontend
    if (req.headers['x-billing-context'] === 'true' || req.query.billing === 'true') {
      return next();
    }
    return res.status(403).json({
      success: false,
      error: 'Staff can only create customers during billing.'
    });
  }
  next();
};

// Middleware: Staff can only view customer details (no edit/delete)
const staffViewOnly = (req, res, next) => {
  if (req.user && req.user.role === 'staff') {
    // Only allow GET requests
    if (req.method !== 'GET') {
      return res.status(403).json({
        success: false,
        error: 'Staff can only view customer details.'
      });
    }
  }
  next();
};

// Role middleware factory: roleMiddleware('owner'), roleMiddleware('staff'), etc.
const roleMiddleware = (role) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
    if (req.user.role !== role) {
      return res.status(403).json({ success: false, error: `Only ${role} can access this resource` });
    }
    next();
  };
};

module.exports = {
  authMiddleware,
  authorize,
  checkOwnerOrStaff,
  adminOnly,
  managerAndAbove,
  staffAndAbove,
  cleanupOTPs,
  staffCreateCustomerRestriction,
  staffViewOnly,
  roleMiddleware
};
