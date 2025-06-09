const mongoose = require('mongoose');

const otpRateLimitSchema = new mongoose.Schema({
  identifier: {
    type: String,
    required: true,
    index: true
  },
  
  type: {
    type: String,
    enum: ['email', 'ip', 'phone'],
    required: true
  },
  
  requests: [{
    timestamp: {
      type: Date,
      default: Date.now
    },
    type: {
      type: String,
      enum: ['email_verification', 'password_reset', 'login', 'phone_verification'],
      required: true
    },
    ipAddress: String,
    userAgent: String
  }],
  
  blockedUntil: {
    type: Date,
    index: true
  }
}, {
  timestamps: true
});

// Compound index for efficient queries
otpRateLimitSchema.index({ identifier: 1, type: 1 });
otpRateLimitSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 }); // 24 hours

// Instance methods
otpRateLimitSchema.methods.isBlocked = function() {
  return this.blockedUntil && this.blockedUntil > new Date();
};

otpRateLimitSchema.methods.addRequest = function(requestType, ipAddress = null, userAgent = null) {
  this.requests.push({
    type: requestType,
    ipAddress: ipAddress,
    userAgent: userAgent
  });
  
  // Keep only last 24 hours of requests
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  this.requests = this.requests.filter(req => req.timestamp > twentyFourHoursAgo);
  
  return this.save();
};

otpRateLimitSchema.methods.getRecentRequests = function(timeWindowMinutes = 60) {
  const timeWindow = new Date(Date.now() - timeWindowMinutes * 60 * 1000);
  return this.requests.filter(req => req.timestamp > timeWindow);
};

otpRateLimitSchema.methods.blockUntil = function(minutes = 60) {
  this.blockedUntil = new Date(Date.now() + minutes * 60 * 1000);
  return this.save();
};

// Static methods
otpRateLimitSchema.statics.checkRateLimit = async function(identifier, type, requestType, ipAddress = null, userAgent = null) {
  const limits = {
    email: { requests: 5, windowMinutes: 60, blockMinutes: 60 },
    ip: { requests: 10, windowMinutes: 60, blockMinutes: 30 },
    phone: { requests: 3, windowMinutes: 60, blockMinutes: 120 }
  };
  
  const limit = limits[type] || limits.email;
  
  let rateLimit = await this.findOne({ identifier, type });
  
  if (!rateLimit) {
    rateLimit = new this({ identifier, type, requests: [] });
  }
  
  // Check if currently blocked
  if (rateLimit.isBlocked()) {
    return {
      allowed: false,
      reason: 'blocked',
      blockedUntil: rateLimit.blockedUntil,
      remainingTime: Math.ceil((rateLimit.blockedUntil - new Date()) / 60000)
    };
  }
  
  // Check recent requests
  const recentRequests = rateLimit.getRecentRequests(limit.windowMinutes);
  
  if (recentRequests.length >= limit.requests) {
    // Block the identifier
    await rateLimit.blockUntil(limit.blockMinutes);
    
    return {
      allowed: false,
      reason: 'rate_limit_exceeded',
      limit: limit.requests,
      windowMinutes: limit.windowMinutes,
      blockedMinutes: limit.blockMinutes
    };
  }
  
  // Add the current request
  await rateLimit.addRequest(requestType, ipAddress, userAgent);
  
  return {
    allowed: true,
    remaining: limit.requests - recentRequests.length - 1,
    resetTime: new Date(Date.now() + limit.windowMinutes * 60 * 1000)
  };
};

otpRateLimitSchema.statics.cleanupExpired = function() {
  return this.deleteMany({
    blockedUntil: { $lt: new Date() },
    createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
  });
};

const OTPRateLimit = mongoose.model('OTPRateLimit', otpRateLimitSchema);

module.exports = OTPRateLimit;
