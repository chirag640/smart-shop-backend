const nodemailer = require('nodemailer');
const twilio = require('twilio');

// Configure nodemailer (example: use env vars for real deployment)
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Configure Twilio
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM;

// Send email
async function sendEmail({ to, subject, text, html }) {
  await transporter.sendMail({ from: process.env.EMAIL_USER, to, subject, text, html });
}

// Send WhatsApp message
async function sendWhatsApp({ to, body }) {
  await twilioClient.messages.create({
    from: `whatsapp:${whatsappFrom}`,
    to: `whatsapp:${to}`,
    body
  });
}

// Daily sales summary (to owner)
async function sendDailySalesSummary({ ownerEmail, summaryText }) {
  await sendEmail({
    to: ownerEmail,
    subject: 'Daily Sales Summary',
    text: summaryText
  });
}

async function sendDailySalesSummaryWhatsApp({ ownerPhone, summaryText }) {
  await sendWhatsApp({
    to: ownerPhone,
    body: `Daily Sales Summary:\n${summaryText}`
  });
}

// Payment reminder (to customer)
async function sendPaymentReminderWhatsApp({ customerPhone, reminderText }) {
  await sendWhatsApp({
    to: customerPhone,
    body: reminderText
  });
}

// Expense alert (to owner email)
async function sendExpenseAlertEmail({ ownerEmail, alertText }) {
  await sendEmail({
    to: ownerEmail,
    subject: 'Expense Alert',
    text: alertText
  });
}

module.exports = {
  sendEmail,
  sendWhatsApp,
  sendDailySalesSummary,
  sendDailySalesSummaryWhatsApp,
  sendPaymentReminderWhatsApp,
  sendExpenseAlertEmail
};
