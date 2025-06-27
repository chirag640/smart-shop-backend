const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const { authMiddleware } = require('../middlewares/auth');
const { sendPushNotification } = require('../utils/pushService');

// Get latest notifications for a user
router.get('/user/:id', authMiddleware, async (req, res) => {
  const userId = req.params.id;
  if (req.user._id.toString() !== userId && req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  const notifications = await Notification.find({ userId }).sort({ createdAt: -1 }).limit(50);
  res.json({ success: true, notifications });
});

// Mark notifications as read
router.post('/mark-read', authMiddleware, async (req, res) => {
  const { notificationIds } = req.body;
  if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
    return res.status(400).json({ success: false, error: 'No notification IDs provided' });
  }
  await Notification.updateMany({ _id: { $in: notificationIds }, userId: req.user._id }, { $set: { isRead: true } });
  res.json({ success: true });
});

// Delete a notification
router.delete('/:id', authMiddleware, async (req, res) => {
  const notification = await Notification.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  if (!notification) return res.status(404).json({ success: false, error: 'Notification not found' });
  res.json({ success: true });
});

// Create a notification (for trigger events)
router.post('/', authMiddleware, async (req, res) => {
  const { userId, title, message, type, relatedEntityId } = req.body;
  if (!userId || !title || !message || !type) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  try {
    const notification = await Notification.create({
      userId,
      title,
      message,
      type,
      relatedEntityId: relatedEntityId || null
    });
    res.status(201).json({ success: true, notification });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Send push notification to user
router.post('/send-push', authMiddleware, async (req, res) => {
  const { userId, title, message, data } = req.body;
  if (!userId || !title || !message) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  try {
    await sendPushNotification({ userId, title, message, data });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
