const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  
  otp: {
    type: String,
    required: true,
    length: 6
  },
  
  type: {
    type: String,
    enum: ['email_verification', 'password_reset', 'login', 'phone_verification'],
    required: true,
    default: 'email_verification'
  },
  
  verified: {
    type: Boolean,
    default: false
  },
  
  attempts: {
    type: Number,
    default: 0,
    max: 5
  },
  
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    index: { expireAfterSeconds: 0 }
  },

  // Store registration data for registration OTPs
  registrationData: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },

  ipAddress: {
    type: String,
    validate: {
      validator: function(value) {
        if (!value) return true;
        // Allow IPv4, IPv6, and localhost variants
        const ipv4Regex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
        const ipv6Regex = /^(?:[a-fA-F0-9]{0,4}:){2,7}[a-fA-F0-9]{0,4}$/;
        const localhostVariants = ['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1'];
        
        return ipv4Regex.test(value) || ipv6Regex.test(value) || localhostVariants.includes(value);
      },
      message: 'Invalid IP address format'
    }
  },
  
  userAgent: {
    type: String,
    maxLength: 500
  }
}, {
  timestamps: true
});

// Indexes
otpSchema.index({ email: 1, type: 1 });
otpSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 }); // 10 minutes

// Instance methods
otpSchema.methods.isExpired = function() {
  return this.expiresAt < new Date();
};

otpSchema.methods.incrementAttempts = function() {
  this.attempts += 1;
  return this.save();
};

otpSchema.methods.markAsVerified = function() {
  this.verified = true;
  return this.save();
};

// Static methods
otpSchema.statics.findValidOTP = function(email, otp, type = 'email_verification') {
  return this.findOne({
    email: email.toLowerCase(),
    otp: otp,
    type: type,
    verified: false,
    expiresAt: { $gt: new Date() },
    attempts: { $lt: 5 }
  });
};

otpSchema.statics.createOTP = async function(email, type = 'email_verification', ipAddress = null, userAgent = null) {
  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Remove any existing unverified OTPs for this email and type
  await this.deleteMany({
    email: email.toLowerCase(),
    type: type,
    verified: false
  });
  
  // Create new OTP
  return this.create({
    email: email.toLowerCase(),
    otp: otp,
    type: type,
    ipAddress: ipAddress,
    userAgent: userAgent
  });
};

// Create OTP for registration with user data
otpSchema.statics.createRegistrationOTP = async function(email, registrationData, ipAddress = null, userAgent = null) {
  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Remove any existing unverified OTPs for this email and type
  await this.deleteMany({
    email: email.toLowerCase(),
    type: 'email_verification',
    verified: false
  });
  
  // Create new OTP with registration data
  return this.create({
    email: email.toLowerCase(),
    otp: otp,
    type: 'email_verification',
    registrationData: registrationData,
    ipAddress: ipAddress,
    userAgent: userAgent
  });
};

otpSchema.statics.cleanupExpired = function() {
  return this.deleteMany({
    expiresAt: { $lt: new Date() }
  });
};

const OTP = mongoose.model('OTP', otpSchema);

module.exports = OTP;
