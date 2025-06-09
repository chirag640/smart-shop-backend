const cron = require('node-cron');
const { OTP, OTPRateLimit } = require('../models');

// Clean up expired OTPs
const cleanupExpiredOTPs = async () => {
  try {
    console.log('🧹 Starting OTP cleanup...');
    
    const [otpResult, rateLimitResult] = await Promise.all([
      OTP.cleanupExpired(),
      OTPRateLimit.cleanupExpired()
    ]);
    
    console.log(`✅ OTP cleanup completed - Removed ${otpResult.deletedCount} expired OTPs and ${rateLimitResult.deletedCount} expired rate limits`);
    
    return {
      success: true,
      deletedOTPs: otpResult.deletedCount,
      deletedRateLimits: rateLimitResult.deletedCount
    };
  } catch (error) {
    console.error('❌ OTP cleanup failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Schedule periodic cleanup
const scheduleOTPCleanup = () => {
  // Run cleanup every hour
  const interval = 60 * 60 * 1000; // 1 hour
  
  setInterval(async () => {
    await cleanupExpiredOTPs();
  }, interval);
  
  console.log('📅 OTP cleanup scheduled to run every hour');
};

// Manual cleanup trigger
const manualCleanup = async (req, res) => {
  try {
    const result = await cleanupExpiredOTPs();
    
    res.status(200).json({
      success: true,
      message: 'OTP cleanup completed successfully',
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to perform OTP cleanup'
    });
  }
};

module.exports = {
  cleanupExpiredOTPs,
  scheduleOTPCleanup,
  manualCleanup
};
