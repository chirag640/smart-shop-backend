// Security middleware with graceful fallbacks for missing dependencies
let helmet, mongoSanitize, xss, hpp;

// Try to import security packages with fallbacks
try {
  helmet = require('helmet');
} catch (err) {
  console.warn('⚠️  Helmet not installed. Using basic security headers fallback.');
  helmet = null;
}

try {
  mongoSanitize = require('express-mongo-sanitize');
} catch (err) {
  console.warn('⚠️  express-mongo-sanitize not installed. Using basic sanitization fallback.');
  mongoSanitize = null;
}

try {
  xss = require('xss-clean');
} catch (err) {
  console.warn('⚠️  xss-clean not installed. Using basic XSS protection fallback.');
  xss = null;
}

try {
  hpp = require('hpp');
} catch (err) {
  console.warn('⚠️  hpp not installed. Using basic parameter pollution protection fallback.');
  hpp = null;
}

// Fallback security middleware implementations
const fallbackHelmet = (req, res, next) => {
  // Basic security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.removeHeader('X-Powered-By');
  next();
};

const fallbackMongoSanitize = (req, res, next) => {
  // Basic MongoDB injection prevention
  const sanitizeValue = (value) => {
    if (typeof value === 'string') {
      return value.replace(/[${}]/g, ''); // Remove $ and {} characters
    }
    return value;
  };
  
  const sanitizeObject = (obj) => {
    if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    } else if (obj && typeof obj === 'object') {
      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        const cleanKey = sanitizeValue(key);
        sanitized[cleanKey] = sanitizeObject(value);
      }
      return sanitized;
    }
    return sanitizeValue(obj);
  };
  
  if (req.body) req.body = sanitizeObject(req.body);
  if (req.query) req.query = sanitizeObject(req.query);
  if (req.params) req.params = sanitizeObject(req.params);
  
  next();
};

const fallbackXss = (req, res, next) => {
  // Basic XSS protection
  const cleanXss = (value) => {
    if (typeof value === 'string') {
      return value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');
    }
    return value;
  };
  
  const cleanObject = (obj) => {
    if (Array.isArray(obj)) {
      return obj.map(cleanObject);
    } else if (obj && typeof obj === 'object') {
      const cleaned = {};
      for (const [key, value] of Object.entries(obj)) {
        cleaned[key] = cleanObject(value);
      }
      return cleaned;
    }
    return cleanXss(obj);
  };
  
  if (req.body) req.body = cleanObject(req.body);
  if (req.query) req.query = cleanObject(req.query);
  
  next();
};

const fallbackHpp = (req, res, next) => {
  // Basic HTTP Parameter Pollution protection
  if (req.query) {
    for (const [key, value] of Object.entries(req.query)) {
      if (Array.isArray(value)) {
        // Keep only the last value if multiple values for same parameter
        req.query[key] = value[value.length - 1];
      }
    }
  }
  next();
};

// Enhanced security logging middleware
const securityLogger = (req, res, next) => {
  const timestamp = new Date().toISOString();
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  const userAgent = req.get('User-Agent') || 'unknown';
  const userId = req.user?.id || 'anonymous';
  const userRole = req.user?.role || 'none';
  
  // Log security-relevant requests
  const securitySensitivePaths = [
    '/auth/',
    '/users/',
    '/inventory/items',
    '/stores',
    '/categories'
  ];
  
  const isSensitivePath = securitySensitivePaths.some(path => 
    req.originalUrl.includes(path)
  );
  
  if (isSensitivePath || req.method !== 'GET') {
    console.log(`🔒 Security Log [${timestamp}] ${req.method} ${req.originalUrl} | User: ${userId} (${userRole}) | IP: ${clientIP} | UA: ${userAgent.substring(0, 100)}`);
  }
  
  // Track failed authentication attempts
  if (req.originalUrl.includes('/auth/') && req.method === 'POST') {
    res.on('finish', () => {
      if (res.statusCode === 401 || res.statusCode === 403) {
        console.warn(`🚨 Auth Failure [${timestamp}] ${req.method} ${req.originalUrl} | IP: ${clientIP} | Status: ${res.statusCode}`);
      }
    });
  }
  
  next();
};

// Input sanitization middleware
const sanitizeInput = (req, res, next) => {
  // Remove any null bytes and normalize input
  const sanitizeValue = (value) => {
    if (typeof value === 'string') {
      return value
        .replace(/\0/g, '') // Remove null bytes
        .trim() // Remove whitespace
        .substring(0, 10000); // Limit length to prevent DoS
    }
    return value;
  };
  
  const sanitizeObject = (obj) => {
    if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    } else if (obj && typeof obj === 'object') {
      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitizeObject(value);
      }
      return sanitized;
    }
    return sanitizeValue(obj);
  };
  
  // Sanitize request body
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  
  // Sanitize query parameters
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  
  next();
};

// Request size limiter
const requestSizeLimiter = (req, res, next) => {
  const maxSize = process.env.MAX_REQUEST_SIZE || '10mb';
  
  // Check content-length header
  const contentLength = req.get('content-length');
  if (contentLength) {
    const sizeMB = parseInt(contentLength) / (1024 * 1024);
    const maxSizeMB = parseInt(maxSize);
    
    if (sizeMB > maxSizeMB) {
      return res.status(413).json({
        success: false,
        error: `Request too large. Maximum size is ${maxSize}`
      });
    }
  }
  
  next();
};

// Enhanced file upload security
const fileUploadSecurity = (req, res, next) => {
  if (req.file || req.files) {
    const allowedMimes = [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/webp'
    ];
    
    const maxFileSize = 5 * 1024 * 1024; // 5MB
    
    const validateFile = (file) => {
      // Check MIME type
      if (!allowedMimes.includes(file.mimetype)) {
        throw new Error(`Invalid file type: ${file.mimetype}. Allowed types: ${allowedMimes.join(', ')}`);
      }
      
      // Check file size
      if (file.size > maxFileSize) {
        throw new Error(`File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB. Maximum allowed: ${maxFileSize / 1024 / 1024}MB`);
      }
      
      // Check file extension
      const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));
      
      if (!allowedExtensions.includes(fileExtension)) {
        throw new Error(`Invalid file extension: ${fileExtension}. Allowed extensions: ${allowedExtensions.join(', ')}`);
      }
    };
    
    try {
      if (req.file) {
        validateFile(req.file);
      }
      
      if (req.files) {
        if (Array.isArray(req.files)) {
          req.files.forEach(validateFile);
        } else {
          Object.values(req.files).forEach(fileArray => {
            if (Array.isArray(fileArray)) {
              fileArray.forEach(validateFile);
            } else {
              validateFile(fileArray);
            }
          });
        }
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
  
  next();
};

// API key validation middleware
const validateApiKey = (req, res, next) => {
  // Skip for auth routes
  if (req.originalUrl.includes('/auth/')) {
    return next();
  }
  
  const apiKey = req.get('X-API-Key');
  const validApiKeys = process.env.API_KEYS ? process.env.API_KEYS.split(',') : [];
  
  // If API keys are configured, validate them
  if (validApiKeys.length > 0) {
    if (!apiKey || !validApiKeys.includes(apiKey)) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or missing API key'
      });
    }
  }
  
  next();
};

// Enhanced CORS headers
const enhancedCors = (req, res, next) => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS ? 
    process.env.ALLOWED_ORIGINS.split(',') : 
    ['http://localhost:3000', 'http://localhost:3001'];
  
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
};

// Comprehensive security middleware stack
const applySecurity = (app) => {
  // Basic security headers - use helmet or fallback
  if (helmet) {
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
      crossOriginEmbedderPolicy: false
    }));
  } else {
    app.use(fallbackHelmet);
  }
  
  // Enhanced CORS
  app.use(enhancedCors);
  
  // Data sanitization - use packages or fallbacks
  if (mongoSanitize) {
    app.use(mongoSanitize()); // Prevent NoSQL injection
  } else {
    app.use(fallbackMongoSanitize);
  }
  
  if (xss) {
    app.use(xss()); // Clean user input from XSS
  } else {
    app.use(fallbackXss);
  }
  
  if (hpp) {
    app.use(hpp()); // Prevent HTTP Parameter Pollution
  } else {
    app.use(fallbackHpp);
  }
  
  // Custom security middleware
  app.use(requestSizeLimiter);
  app.use(sanitizeInput);
  app.use(securityLogger);
  
  // API key validation (optional)
  if (process.env.REQUIRE_API_KEY === 'true') {
    app.use(validateApiKey);
  }
  
  console.log('🔒 Security middleware applied successfully');
};

module.exports = {
  securityLogger,
  sanitizeInput,
  requestSizeLimiter,
  fileUploadSecurity,
  validateApiKey,
  enhancedCors,
  applySecurity
};
