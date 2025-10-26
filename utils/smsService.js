// SMS service utility for sending OTPs
const twilio = require('twilio');

// Initialize Twilio client
const getTwilioClient = () => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  
  if (!accountSid || !authToken) {
    if (process.env.NODE_ENV !== 'development') {
      throw new Error('Twilio credentials not configured');
    }
    return null;
  }
  
  return twilio(accountSid, authToken);
};

const sendOTPSMS = async (phone, otp) => {
  try {
    const client = getTwilioClient();
    
    if (process.env.NODE_ENV === 'development' && !client) {
        // For development without Twilio credentials, just log the OTP
        const logger = require('./logger');
        logger.debug({ phone, otp }, 'OTP (development only) - Twilio not configured');
        logger.warn('SMS not sent - Twilio credentials not configured for development');
        return true;
      }
    
    if (!client) {
      throw new Error('Twilio client not initialized');
    }
    
    const message = await client.messages.create({
      body: `Your Smart Shop verification code is: ${otp}. This code will expire in 10 minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone
    });
    
    const logger = require('./logger');
    logger.info({ phone, sid: message.sid }, 'SMS sent successfully');
    
    if (process.env.NODE_ENV === 'development') {
      logger.debug({ phone, otp }, 'OTP (development only)');
    }
    
    return true;
  } catch (error) {
    const logger = require('./logger');
    logger.error({ err: error }, 'SMS sending failed');
    
    // In development, don't fail completely if SMS service is not configured
    if (process.env.NODE_ENV === 'development') {
      logger.warn({ phone, otp }, 'OTP (development only) - SMS service error');
      return true;
    }
    
    throw new Error('Failed to send OTP SMS');
  }
};

module.exports = {
  sendOTPSMS
};
