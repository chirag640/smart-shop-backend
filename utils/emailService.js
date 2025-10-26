// Email service utility for sending OTPs
const nodemailer = require('nodemailer');

// Create transporter based on environment
const createTransporter = async () => {
  // Check if Gmail SMTP credentials are available
  if (process.env.SMTP_EMAIL && process.env.SMTP_PASSWORD) {
    const logger = require('./logger');
    logger.info('Using Gmail SMTP for email service');
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD // Gmail App Password
      }
    });
  } else if (process.env.NODE_ENV === 'development') {
    // For development, create test account if no Gmail credentials provided
    if (!process.env.ETHEREAL_EMAIL || !process.env.ETHEREAL_PASSWORD) {
      const logger = require('./logger');
      logger.debug('Creating test email account for development');
      const testAccount = await nodemailer.createTestAccount();
      return nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
    } else {
      // Use provided Ethereal credentials
      return nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: process.env.ETHEREAL_EMAIL,
          pass: process.env.ETHEREAL_PASSWORD
        }
      });
    }
  } else {
    // For production, use Gmail or other service
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD
      }
    });
  }
};

// Email template generator
const generateEmailTemplate = (type, data) => {
  const baseStyle = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Smart Shop</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f4f7fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr>
          <td style="padding: 40px 20px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1); overflow: hidden;">
  `;

  const headerTemplate = `
    <tr>
      <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
        <div style="background-color: rgba(255, 255, 255, 0.15); width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(10px);">
          <div style="font-size: 36px; color: white;">🛍️</div>
        </div>
        <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Smart Shop</h1>
        <p style="color: rgba(255, 255, 255, 0.9); margin: 8px 0 0; font-size: 16px; font-weight: 400;">${data.subtitle || 'Welcome'}</p>
      </td>
    </tr>
  `;

  const footerTemplate = `
    <tr>
      <td style="background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="color: #718096; margin: 0 0 8px; font-size: 14px;">This email was sent by Smart Shop</p>
        <p style="color: #a0aec0; margin: 0; font-size: 12px;">© 2025 Smart Shop. All rights reserved.</p>
        <div style="margin-top: 16px;">
          <a href="#" style="color: #667eea; text-decoration: none; font-size: 12px; margin: 0 8px;">Privacy Policy</a>
          <span style="color: #cbd5e0;">|</span>
          <a href="#" style="color: #667eea; text-decoration: none; font-size: 12px; margin: 0 8px;">Terms of Service</a>
          <span style="color: #cbd5e0;">|</span>
          <a href="#" style="color: #667eea; text-decoration: none; font-size: 12px; margin: 0 8px;">Support</a>
        </div>
      </td>
    </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;

  let contentTemplate = '';

  switch (type) {
    case 'otp':
      contentTemplate = `
        <tr>
          <td style="padding: 50px 40px;">
            <div style="text-align: center;">
              <h2 style="color: #1a202c; margin: 0 0 16px; font-size: 24px; font-weight: 600;">Verification Required</h2>
              <p style="color: #4a5568; margin: 0 0 32px; font-size: 16px; line-height: 1.6;">We received a request to verify your identity. Please use the code below to complete your verification.</p>
              
              <div style="background: linear-gradient(135deg, #f7fafc 0%, #edf2f7 100%); border: 2px dashed #cbd5e0; border-radius: 12px; padding: 30px; margin: 32px 0;">
                <p style="color: #718096; margin: 0 0 12px; font-size: 14px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">Your Verification Code</p>
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 16px 24px; font-size: 32px; font-weight: 700; border-radius: 8px; letter-spacing: 4px; font-family: 'Courier New', monospace; display: inline-block; box-shadow: 0 4px 20px rgba(102, 126, 234, 0.3);">
                  ${data.otp}
                </div>
              </div>
              
              <div style="background-color: #fff5f5; border-left: 4px solid #feb2b2; padding: 16px 20px; border-radius: 0 8px 8px 0; margin: 24px 0; text-align: left;">
                <div style="display: flex; align-items: center;">
                  <span style="font-size: 18px; margin-right: 8px;">⏰</span>
                  <div>
                    <p style="color: #c53030; margin: 0; font-size: 14px; font-weight: 600;">Time Sensitive</p>
                    <p style="color: #742a2a; margin: 4px 0 0; font-size: 13px;">This code expires in 10 minutes for your security.</p>
                  </div>
                </div>
              </div>
              
              <div style="background-color: #f7fafc; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: left;">
                <h3 style="color: #2d3748; margin: 0 0 12px; font-size: 16px; font-weight: 600; display: flex; align-items: center;">
                  <span style="margin-right: 8px;">🔒</span>
                  Security Notice
                </h3>
                <ul style="color: #4a5568; margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.5;">
                  <li style="margin-bottom: 4px;">Never share this code with anyone</li>
                  <li style="margin-bottom: 4px;">We'll never ask for this code via phone or email</li>
                  <li>If you didn't request this, you can safely ignore this email</li>
                </ul>
              </div>
            </div>
          </td>
        </tr>
      `;
      break;

    case 'welcome':
      contentTemplate = `
        <tr>
          <td style="padding: 50px 40px;">
            <div style="text-align: center;">
              <h2 style="color: #1a202c; margin: 0 0 16px; font-size: 24px; font-weight: 600;">Welcome to Smart Shop! 🎉</h2>
              <p style="color: #4a5568; margin: 0 0 32px; font-size: 16px; line-height: 1.6;">Thank you for joining our community. We're excited to have you on board!</p>
              
              <div style="background: linear-gradient(135deg, #f0fff4 0%, #c6f6d5 100%); border-radius: 12px; padding: 30px; margin: 32px 0;">
                <h3 style="color: #22543d; margin: 0 0 16px; font-size: 18px; font-weight: 600;">What's Next?</h3>
                <div style="text-align: left; color: #2f855a;">
                  <p style="margin: 8px 0; font-size: 14px;">✅ Your account has been verified</p>
                  <p style="margin: 8px 0; font-size: 14px;">🛍️ Start exploring our products</p>
                  <p style="margin: 8px 0; font-size: 14px;">💳 Add your payment methods</p>
                  <p style="margin: 8px 0; font-size: 14px;">📱 Download our mobile app</p>
                </div>
              </div>
              
              <div style="margin: 32px 0;">
                <a href="${data.loginUrl || '#'}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block; box-shadow: 0 4px 20px rgba(102, 126, 234, 0.3);">
                  Start Shopping
                </a>
              </div>
            </div>
          </td>
        </tr>
      `;
      break;

    case 'password-reset':
      contentTemplate = `
        <tr>
          <td style="padding: 50px 40px;">
            <div style="text-align: center;">
              <h2 style="color: #1a202c; margin: 0 0 16px; font-size: 24px; font-weight: 600;">Password Reset Request</h2>
              <p style="color: #4a5568; margin: 0 0 32px; font-size: 16px; line-height: 1.6;">We received a request to reset your password. Click the button below to create a new password.</p>
              
              <div style="margin: 32px 0;">
                <a href="${data.resetUrl || '#'}" style="background: linear-gradient(135deg, #e53e3e 0%, #c53030 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block; box-shadow: 0 4px 20px rgba(229, 62, 62, 0.3);">
                  Reset Password
                </a>
              </div>
              
              <div style="background-color: #fff5f5; border-left: 4px solid #feb2b2; padding: 16px 20px; border-radius: 0 8px 8px 0; margin: 24px 0; text-align: left;">
                <p style="color: #c53030; margin: 0; font-size: 14px; font-weight: 600;">⚠️ Security Notice</p>
                <p style="color: #742a2a; margin: 4px 0 0; font-size: 13px;">This link expires in 1 hour. If you didn't request this, please ignore this email.</p>
              </div>
            </div>
          </td>
        </tr>
      `;
      break;

    default:
      contentTemplate = `
        <tr>
          <td style="padding: 50px 40px;">
            <div style="text-align: center;">
              <h2 style="color: #1a202c; margin: 0 0 16px; font-size: 24px; font-weight: 600;">${data.title || 'Notification'}</h2>
              <p style="color: #4a5568; margin: 0 0 32px; font-size: 16px; line-height: 1.6;">${data.message || 'Thank you for using Smart Shop!'}</p>
            </div>
          </td>
        </tr>
      `;
  }

  return baseStyle + headerTemplate + contentTemplate + footerTemplate;
};

const sendOTPEmail = async (email, otp) => {
  try {
    const transporter = await createTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'Smart Shop <noreply@smartshop.com>',
      to: email,
      subject: '🔐 Your Smart Shop Verification Code',
      html: generateEmailTemplate('otp', {
        subtitle: 'Secure Verification',
        otp: otp
      })
    };

    const info = await transporter.sendMail(mailOptions);
    
    const logger = require('./logger');
    if (process.env.NODE_ENV === 'development') {
      logger.debug({ email, otp }, 'OTP generated (development only)');
      logger.debug({ previewUrl: nodemailer.getTestMessageUrl(info) }, 'Nodemailer preview URL');
    }

    logger.info({ to: email }, 'Email sent successfully');
    return true;
  } catch (error) {
  const logger = require('./logger');
  logger.error({ err: error }, 'Email sending failed');
    
    // For development, log the OTP and continue even if email fails
    if (process.env.NODE_ENV === 'development') {
      const logger = require('./logger');
      logger.warn({ email, otp }, 'EMAIL SERVICE FAILED - Development OTP (logged for testing)');
      logger.warn('Email service not configured properly, but OTP is shown above for testing');
      return true; // Don't fail in development
    }
    
    throw new Error('Failed to send OTP email');
  }
};

// Enhanced email sending functions
const sendWelcomeEmail = async (email, userData = {}) => {
  try {
    const transporter = await createTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'Smart Shop <noreply@smartshop.com>',
      to: email,
      subject: '🎉 Welcome to Smart Shop - Let\'s Get Started!',
      html: generateEmailTemplate('welcome', {
        subtitle: 'Welcome Aboard',
        loginUrl: userData.loginUrl || process.env.FRONTEND_URL || '#'
      })
    };

    const info = await transporter.sendMail(mailOptions);
    
    if (process.env.NODE_ENV === 'development') {
        const logger = require('./logger');
        logger.debug({ to: email }, 'Welcome email sent (development)');
        logger.debug({ previewUrl: nodemailer.getTestMessageUrl(info) }, 'Nodemailer preview URL');
    }
    
  const logger = require('./logger');
  logger.info({ to: email }, 'Welcome email sent successfully');
    return true;
  } catch (error) {
  const logger = require('./logger');
  logger.error({ err: error }, 'Welcome email sending failed');
    throw new Error('Failed to send welcome email');
  }
};

const sendPasswordResetEmail = async (email, resetUrl) => {
  try {
    const transporter = await createTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'Smart Shop <noreply@smartshop.com>',
      to: email,
      subject: '🔒 Reset Your Smart Shop Password',
      html: generateEmailTemplate('password-reset', {
        subtitle: 'Password Reset',
        resetUrl: resetUrl
      })
    };

    const info = await transporter.sendMail(mailOptions);
    
    if (process.env.NODE_ENV === 'development') {
  const logger = require('./logger');
  logger.debug({ to: email }, 'Password reset email sent (development)');
  logger.debug({ previewUrl: nodemailer.getTestMessageUrl(info) }, 'Nodemailer preview URL');
    }
    
  const logger = require('./logger');
  logger.info({ to: email }, 'Password reset email sent successfully');
    return true;
  } catch (error) {
  const logger = require('./logger');
  logger.error({ err: error }, 'Password reset email sending failed');
    throw new Error('Failed to send password reset email');
  }
};

module.exports = {
  sendOTPEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail
};
