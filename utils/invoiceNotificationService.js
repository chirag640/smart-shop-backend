/**
 * Invoice Notification Service
 * Handles sending invoices via WhatsApp and Email
 */

const nodemailer = require('nodemailer');
const twilio = require('twilio');
const path = require('path');
const fs = require('fs').promises;
const logger = require('./logger');

/**
 * WhatsApp Service using Twilio - DISABLED FOR NOW
 */
class WhatsAppService {
  constructor() {
  this.client = null;
  // this.initialize(); // Commented out for now
  logger.info('WhatsApp service disabled - using email only');
  }

  // initialize() {
  //   const accountSid = process.env.TWILIO_ACCOUNT_SID;
  //   const authToken = process.env.TWILIO_AUTH_TOKEN;
    
  //   if (accountSid && authToken) {
  //     this.client = twilio(accountSid, authToken);
  //     console.log('✅ WhatsApp service initialized');
  //   } else {
  //     console.log('⚠️  WhatsApp service not configured - missing Twilio credentials');
  //   }
  // }

  /**
   * Send invoice PDF to customer via WhatsApp - DISABLED
   */
  async sendInvoicePDF(customerPhone, invoiceData, pdfBuffer) {
    // WhatsApp functionality temporarily disabled
  logger.info({ invoiceNumber: invoiceData.invoiceNumber, phone: customerPhone }, 'WhatsApp disabled - would send invoice');
    
    return {
      success: false,
      disabled: true,
      message: 'WhatsApp notifications are temporarily disabled',
      phone: customerPhone
    };
    
    /* ORIGINAL CODE - COMMENTED OUT
    try {
      if (!this.client) {
        if (process.env.NODE_ENV === 'development') {
      logger.info({ invoiceNumber: invoiceData.invoiceNumber, phone: customerPhone }, 'WhatsApp (DEV) - would send invoice');
          return { success: true, messageId: 'dev-mode', development: true };
        }
        throw new Error('WhatsApp service not configured');
      }

      // Format phone number for WhatsApp (must include country code)
      const whatsappNumber = this.formatWhatsAppNumber(customerPhone);
      
      // Create message content
      const messageText = this.createInvoiceMessage(invoiceData);
      
      // Send message with PDF attachment
      const message = await this.client.messages.create({
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: `whatsapp:${whatsappNumber}`,
        body: messageText,
        mediaUrl: pdfBuffer ? [await this.uploadPDFToTwilio(pdfBuffer, invoiceData.invoiceNumber)] : undefined
      });

  logger.info({ phone: customerPhone, sid: message.sid }, 'WhatsApp invoice sent');
      
      return {
        success: true,
        messageId: message.sid,
        status: message.status,
        phone: whatsappNumber
      };

    } catch (error) {
      logger.error({ err: error }, 'WhatsApp sending failed');
      return {
        success: false,
        error: error.message,
        phone: customerPhone
      };
    }
    */
  }

  /**
   * Format phone number for WhatsApp - DISABLED
   */
  // formatWhatsAppNumber(phone) {
  //   // Remove all non-numeric characters
  //   let cleanPhone = phone.replace(/\D/g, '');
    
  //   // Add country code if missing (assuming India +91)
  //   if (!cleanPhone.startsWith('91') && cleanPhone.length === 10) {
  //     cleanPhone = '91' + cleanPhone;
  //   }
    
  //   return '+' + cleanPhone;
  // }

  /**
   * Create WhatsApp message for invoice - DISABLED
   */
  // createInvoiceMessage(invoiceData) {
  //   const { invoiceNumber, customerName, totalAmount, items, paymentMode } = invoiceData;
    
  //   return `🧾 *Invoice from Smart Shop*

  // 📋 Invoice: ${invoiceNumber}
  // 👤 Customer: ${customerName}
  // 💰 Amount: ₹${totalAmount}
  // 💳 Payment: ${paymentMode.toUpperCase()}
  // 📅 Date: ${new Date().toLocaleDateString('en-IN')}

  // 📦 Items: ${items.length} item(s)
  // ${items.map(item => `• ${item.itemName} (${item.quantity}x)`).join('\n')}

  // Thank you for shopping with us! 🙏

  // *Please save this invoice for your records.*`;
  // }

  /**
   * Upload PDF to Twilio for media sharing - DISABLED
   */
  // async uploadPDFToTwilio(pdfBuffer, invoiceNumber) {
  //   // In a real implementation, you might need to upload to a cloud storage
  //   // and return the public URL for Twilio to access
  //   // For now, return a placeholder
  //   return `https://your-domain.com/invoices/${invoiceNumber}.pdf`;
  // }
}

/**
 * Enhanced Email Service for Invoices
 */
class InvoiceEmailService {
  constructor() {
    this.transporter = null;
    this.initialize();
  }
  async initialize() {
    try {
  logger.info('Initializing email service');
  logger.debug({ smtpEmailSet: !!process.env.SMTP_EMAIL, smtpPasswordSet: !!process.env.SMTP_PASSWORD, nodeEnv: process.env.NODE_ENV || 'Not set' }, 'Email service config');
      
      this.transporter = await this.createTransporter();
      
      // Test the connection
      if (this.transporter) {
        await this.transporter.verify();
  logger.info('Email service initialized and verified');
      }
    } catch (error) {
  logger.error({ err: error }, 'Email service initialization failed');
      
      if (error.message.includes('Invalid login')) {
  logger.warn('Gmail users: Make sure to use App Password, not regular password');
  logger.warn('Enable 2FA and generate App Password: Google Account → Security → App passwords');
      }
    }
  }
  async createTransporter() {
    // Check if Gmail SMTP credentials are available
    if (process.env.SMTP_EMAIL && process.env.SMTP_PASSWORD) {
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_EMAIL,
          pass: process.env.SMTP_PASSWORD
        }
      });
    } else if (process.env.NODE_ENV === 'development') {
      // For development, create test account
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
      throw new Error('Email service not configured - missing SMTP credentials');
    }
  }

  /**
   * Send invoice PDF via email
   */
  async sendInvoicePDF(customerEmail, invoiceData, pdfBuffer) {
    try {
      if (!this.transporter) {
        await this.initialize();
      }

      if (!this.transporter) {
        throw new Error('Email service not configured');
      }

      const mailOptions = {
        from: {
          name: process.env.COMPANY_NAME || 'Smart Shop',
          address: process.env.SMTP_EMAIL || 'noreply@smartshop.com'
        },
        to: customerEmail,
        subject: `Invoice ${invoiceData.invoiceNumber} - Smart Shop`,
        html: this.createInvoiceEmailHTML(invoiceData),
        attachments: pdfBuffer ? [
          {
            filename: `Invoice-${invoiceData.invoiceNumber}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf'
          }
        ] : []
      };

      const result = await this.transporter.sendMail(mailOptions);
      
  logger.info({ email: customerEmail, messageId: result.messageId }, 'Invoice email sent');
      
      // For development with Ethereal, log preview URL
      if (process.env.NODE_ENV === 'development' && result.messageId) {
        logger.info({ previewUrl: nodemailer.getTestMessageUrl(result) }, 'Email preview URL (dev)');
      }

      return {
        success: true,
        messageId: result.messageId,
        email: customerEmail,
        previewUrl: process.env.NODE_ENV === 'development' ? nodemailer.getTestMessageUrl(result) : null
      };

    } catch (error) {
      logger.error({ err: error }, 'Email sending failed');
      return {
        success: false,
        error: error.message,
        email: customerEmail
      };
    }
  }

  /**
   * Create HTML email template for invoice
   */
  createInvoiceEmailHTML(invoiceData) {
    const { invoiceNumber, customerName, totalAmount, items, paymentMode, createdAt } = invoiceData;
    
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Invoice ${invoiceNumber}</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4f46e5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
        .invoice-details { background: white; padding: 15px; border-radius: 6px; margin: 15px 0; }
        .item-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
        .total { font-weight: bold; font-size: 18px; color: #059669; }
        .footer { background: #374151; color: white; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; }
        .btn { background: #4f46e5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🧾 Smart Shop Invoice</h1>
        <h2>Invoice #${invoiceNumber}</h2>
    </div>
    
    <div class="content">
        <div class="invoice-details">
            <h3>📋 Invoice Details</h3>
            <p><strong>Customer:</strong> ${customerName}</p>
            <p><strong>Date:</strong> ${new Date(createdAt).toLocaleDateString('en-IN')}</p>
            <p><strong>Payment Mode:</strong> ${paymentMode.toUpperCase()}</p>
        </div>
        
        <div class="invoice-details">
            <h3>📦 Items Purchased</h3>
            ${items.map(item => `
                <div class="item-row">
                    <span>${item.itemName} (${item.quantity}x)</span>
                    <span>₹${item.totalPrice}</span>
                </div>
            `).join('')}
            
            <div class="item-row total">
                <span>Total Amount</span>
                <span>₹${totalAmount}</span>
            </div>
        </div>
        
        <div style="text-align: center; margin: 20px 0;">
            <p>📄 Please find your invoice PDF attached to this email.</p>
            <p>Thank you for shopping with Smart Shop! 🙏</p>
        </div>
    </div>
    
    <div class="footer">
        <p>Smart Shop - Your Trusted Shopping Partner</p>
        <p>📞 Contact us: ${process.env.COMPANY_PHONE || '+91 9876543210'} | 📧 ${process.env.COMPANY_EMAIL || 'support@smartshop.com'}</p>
    </div>
</body>
</html>`;
  }
}

/**
 * Main Invoice Notification Service
 */
class InvoiceNotificationService {
  constructor() {
    this.whatsAppService = new WhatsAppService();
    this.emailService = new InvoiceEmailService();
  }

  /**
   * Send invoice notifications based on preferences
   */
  async sendInvoiceNotifications(options) {
    const {
      invoiceData,
      pdfBuffer,
      customerEmail,
      customerPhone,
      sendWhatsApp = false,
      sendEmail = false
    } = options;

    const results = {
      whatsApp: null,
      email: null,
      summary: {
        totalSent: 0,
        totalFailed: 0,
        channels: []
      }
    };    // Send WhatsApp notification - DISABLED FOR NOW
    if (sendWhatsApp && customerPhone) {
      logger.info({ phone: customerPhone }, 'WhatsApp disabled: skipping notification');
      results.whatsApp = {
        success: false,
        disabled: true,
        message: 'WhatsApp notifications are temporarily disabled',
        phone: customerPhone
      };
      
  results.summary.totalFailed++;
  logger.warn('WhatsApp notification skipped (service disabled)');
      
      /* ORIGINAL CODE - COMMENTED OUT
      console.log(`📱 Sending WhatsApp invoice to ${customerPhone}...`);
      results.whatsApp = await this.whatsAppService.sendInvoicePDF(
        customerPhone,
        invoiceData,
        pdfBuffer
      );
      
      if (results.whatsApp.success) {
        results.summary.totalSent++;
        results.summary.channels.push('WhatsApp');
      } else {
        results.summary.totalFailed++;
      }
      */
    }

    // Send Email notification
    if (sendEmail && customerEmail) {
  logger.info({ email: customerEmail }, 'Sending email invoice');
      results.email = await this.emailService.sendInvoicePDF(
        customerEmail,
        invoiceData,
        pdfBuffer
      );
      
      if (results.email.success) {
        results.summary.totalSent++;
        results.summary.channels.push('Email');
      } else {
        results.summary.totalFailed++;
      }
    }

    // Log summary
    logger.info({ summary: results.summary }, 'Notification summary');
    if (results.summary.channels.length > 0) {
      logger.info({ channels: results.summary.channels }, 'Channels used');
    }

    return results;
  }
}

// Export services
module.exports = {
  InvoiceNotificationService,
  WhatsAppService,
  InvoiceEmailService
};
