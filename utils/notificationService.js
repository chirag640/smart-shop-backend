const Notification = require('../models/Notification');
const { sendPushNotification } = require('./pushService');
const {
  sendDailySalesSummary,
  sendDailySalesSummaryWhatsApp,
  sendPaymentReminderWhatsApp,
  sendExpenseAlertEmail
} = require('./alertService');

/**
 * Send an in-app notification to a user
 * @param {Object} opts
 * @param {String} opts.userId - User to notify
 * @param {String} opts.title - Notification title
 * @param {String} opts.message - Notification message
 * @param {String} opts.type - Notification type (e.g., low-stock, bill, credit, expense, activity)
 * @param {String} [opts.relatedEntityId] - Optional related entity (e.g., billId, itemId)
 */
async function sendNotification({ userId, title, message, type, relatedEntityId = null }) {
  if (!userId || !title || !message || !type) return;
  await Notification.create({ userId, title, message, type, relatedEntityId });
}

// Low Stock Alert
async function notifyLowStock({ userId, itemName, itemId, currentQty, ownerEmail, ownerPhone }) {
  await sendNotification({
    userId,
    title: 'Low Stock Alert',
    message: `Stock for ${itemName} is low (${currentQty} left).`,
    type: 'low-stock',
    relatedEntityId: itemId
  });
  await sendPushNotification({
    userId,
    title: 'Low Stock Alert',
    message: `Stock for ${itemName} is low (${currentQty} left).`,
    data: { type: 'low-stock', itemId: String(itemId) }
  });
  // Optionally send WhatsApp/email to owner if contact provided
  if (ownerEmail) {
    await sendDailySalesSummary({ ownerEmail, summaryText: `Low stock: ${itemName} (${currentQty} left)` });
  }
  if (ownerPhone) {
    await sendDailySalesSummaryWhatsApp({ ownerPhone, summaryText: `Low stock: ${itemName} (${currentQty} left)` });
  }
}

// Bill Created with Credit
async function notifyBillCredit({ userId, billId, amount, customerPhone }) {
  await sendNotification({
    userId,
    title: 'Pending Payment',
    message: `A bill of ₹${amount} was created on credit.`,
    type: 'credit',
    relatedEntityId: billId
  });
  await sendPushNotification({
    userId,
    title: 'Pending Payment',
    message: `A bill of ₹${amount} was created on credit.`,
    data: { type: 'credit', billId: String(billId) }
  });
  // Optionally send WhatsApp payment reminder to customer
  if (customerPhone) {
    await sendPaymentReminderWhatsApp({ customerPhone, reminderText: `You have a pending payment of ₹${amount}. Please pay soon.` });
  }
}

// Expense Due/Added
async function notifyExpense({ userId, expenseId, title, amount, ownerEmail }) {
  await sendNotification({
    userId,
    title: 'Expense Alert',
    message: `Expense "${title}" of ₹${amount} is due/added.`,
    type: 'expense',
    relatedEntityId: expenseId
  });
  await sendPushNotification({
    userId,
    title: 'Expense Alert',
    message: `Expense "${title}" of ₹${amount} is due/added.`,
    data: { type: 'expense', expenseId: String(expenseId) }
  });
  // Optionally send email alert to owner
  if (ownerEmail) {
    await sendExpenseAlertEmail({ ownerEmail, alertText: `Expense "${title}" of ₹${amount} is due/added.` });
  }
}

// Staff Bill Activity (notify owner)
async function notifyStaffBill({ ownerId, staffName, billId, ownerEmail, ownerPhone, summaryText }) {
  await sendNotification({
    userId: ownerId,
    title: 'Staff Activity',
    message: `${staffName} created a new bill.`,
    type: 'activity',
    relatedEntityId: billId
  });
  await sendPushNotification({
    userId: ownerId,
    title: 'Staff Activity',
    message: `${staffName} created a new bill.`,
    data: { type: 'activity', billId: String(billId) }
  });
  // Optionally send daily sales summary to owner
  if (ownerEmail && summaryText) {
    await sendDailySalesSummary({ ownerEmail, summaryText });
  }
  if (ownerPhone && summaryText) {
    await sendDailySalesSummaryWhatsApp({ ownerPhone, summaryText });
  }
}

module.exports = {
  sendNotification,
  notifyLowStock,
  notifyBillCredit,
  notifyExpense,
  notifyStaffBill
};
