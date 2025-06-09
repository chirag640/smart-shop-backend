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
      console.log(`📱 OTP for ${phone}: ${otp}`);
      console.log('⚠️  SMS not sent - Twilio credentials not configured for development');
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
    
    console.log(`SMS sent successfully to ${phone}, SID: ${message.sid}`);
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`📱 OTP for ${phone}: ${otp}`);
    }
    
    return true;
  } catch (error) {
    console.error('SMS sending failed:', error);
    
    // In development, don't fail completely if SMS service is not configured
    if (process.env.NODE_ENV === 'development') {
      console.log(`📱 OTP for ${phone}: ${otp} (SMS service error, showing OTP in console)`);
      return true;
    }
    
    throw new Error('Failed to send OTP SMS');
  }
};

module.exports = {
  sendOTPSMS
};
