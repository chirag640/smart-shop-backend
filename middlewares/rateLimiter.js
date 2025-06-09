const rateLimit = require('express-rate-limit');
const MongoStore = require('rate-limit-mongo');
const { OTPRateLimit } = require('../models');

// Basic rate limiter configuration
const createBasicLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      error: message,
      retryAfter: Math.ceil(windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Use MongoDB store for distributed rate limiting
    store: process.env.MONGO_URI ? new MongoStore({
      uri: process.env.MONGO_URI,
      collectionName: 'rateLimits',
      expireTimeMs: windowMs
    }) : undefined
  });
};

// General API rate limiter
const generalLimiter = createBasicLimiter(
  15 * 60 * 1000, // 15 minutes
  100, // 100 requests per window
  'Too many requests from this IP, please try again later'
);

// Authentication rate limiter
const authLimiter = createBasicLimiter(
  15 * 60 * 1000, // 15 minutes
  10, // 10 attempts per window
  'Too many authentication attempts, please try again later'
);

// OTP rate limiter
const otpLimiter = createBasicLimiter(
  60 * 60 * 1000, // 1 hour
  5, // 5 OTP requests per hour
  'Too many OTP requests, please try again later'
);

// Upload rate limiter
const uploadLimiter = createBasicLimiter(
  60 * 60 * 1000, // 1 hour
  20, // 20 uploads per hour
  'Too many upload requests, please try again later'
);

// Strict rate limiter for sensitive operations
const strictLimiter = createBasicLimiter(
  15 * 60 * 1000, // 15 minutes
  3, // 3 attempts per window
  'Too many sensitive operation attempts, please try again later'
);

// Custom OTP rate limiter using database
const customOTPLimiter = async (req, res, next) => {
  try {
    const { email } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required for rate limiting'
      });
    }
    
    // Check rate limits for both email and IP
    const [emailCheck, ipCheck] = await Promise.all([
      OTPRateLimit.checkRateLimit(email.toLowerCase(), 'email', 'email_verification', ipAddress, userAgent),
      OTPRateLimit.checkRateLimit(ipAddress, 'ip', 'email_verification', ipAddress, userAgent)
    ]);
    
    // If either email or IP is blocked/limited, deny request
    if (!emailCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: emailCheck.reason === 'blocked' 
          ? `Email temporarily blocked. Try again in ${emailCheck.remainingTime} minutes.`
          : `Too many OTP requests for this email. Try again in ${emailCheck.windowMinutes} minutes.`,
        retryAfter: emailCheck.remainingTime || emailCheck.windowMinutes * 60,
        details: emailCheck
      });
    }
    
    if (!ipCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: ipCheck.reason === 'blocked'
          ? `IP temporarily blocked. Try again in ${ipCheck.remainingTime} minutes.`
          : `Too many OTP requests from this IP. Try again in ${ipCheck.windowMinutes} minutes.`,
        retryAfter: ipCheck.remainingTime || ipCheck.windowMinutes * 60,
        details: ipCheck
      });
    }
    
    // Add rate limit info to response headers
    res.set({
      'X-RateLimit-Email-Remaining': emailCheck.remaining.toString(),
      'X-RateLimit-IP-Remaining': ipCheck.remaining.toString(),
      'X-RateLimit-Reset': emailCheck.resetTime.toISOString()
    });
    
    next();
  } catch (error) {
    console.error('OTP rate limiter error:', error);
    // Allow request to proceed if rate limiter fails
    next();
  }
};

// IP-based rate limiter for specific routes
const createIPLimiter = (windowMs, max, skipSuccessfulRequests = false) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      error: 'Too many requests from this IP address',
      retryAfter: Math.ceil(windowMs / 1000)
    },
    skipSuccessfulRequests,
    keyGenerator: (req) => {
      return req.ip || req.connection.remoteAddress;
    }
  });
};

// User-based rate limiter (requires authentication)
const createUserLimiter = (windowMs, max) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      error: 'Too many requests for this user account',
      retryAfter: Math.ceil(windowMs / 1000)
    },
    keyGenerator: (req) => {
      return req.user ? req.user.id : req.ip;
    },
    skip: (req) => !req.user // Skip if user is not authenticated
  });
};

// Progressive rate limiter (increases restriction after violations)
const createProgressiveLimiter = (baseWindowMs, baseMax) => {
  const violations = new Map();
  
  return rateLimit({
    windowMs: baseWindowMs,
    max: (req) => {
      const key = req.ip || req.connection.remoteAddress;
      const violationCount = violations.get(key) || 0;
      
      // Reduce limit by 20% for each violation, minimum 1
      return Math.max(1, Math.floor(baseMax * Math.pow(0.8, violationCount)));
    },
    onLimitReached: (req) => {
      const key = req.ip || req.connection.remoteAddress;
      violations.set(key, (violations.get(key) || 0) + 1);
      
      // Clean up old violations every hour
      setTimeout(() => {
        violations.delete(key);
      }, 60 * 60 * 1000);
    }
  });
};

module.exports = {
  generalLimiter,
  authLimiter,
  otpLimiter,
  uploadLimiter,
  strictLimiter,
  customOTPLimiter,
  createIPLimiter,
  createUserLimiter,
  createProgressiveLimiter,
  createBasicLimiter
};
