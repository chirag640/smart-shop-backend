const express = require('express');
const router = express.Router();
const DeviceLog = require('../models/DeviceLog');
const { authMiddleware, roleMiddleware } = require('../middlewares/auth');
const { logAudit } = require('../utils/auditLogService');

// Register or update device
router.post('/register-device', authMiddleware, async (req, res) => {
  const { deviceId, deviceModel, platform, token } = req.body;
  if (!deviceId || !deviceModel || !platform) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  await DeviceLog.findOneAndUpdate(
    { userId: req.user._id, deviceId },
    { deviceModel, platform, token, loginAt: new Date(), isActive: true },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  res.json({ success: true });
});

// View active devices for a user (owner only)
router.get('/user/:userId', authMiddleware, roleMiddleware('owner'), async (req, res) => {
  const { userId } = req.params;
  const devices = await DeviceLog.find({ userId, isActive: true });
  res.json({ success: true, devices });
});

// Deactivate (logout) a device
router.post('/deactivate', authMiddleware, async (req, res) => {
  const { deviceId } = req.body;
  if (!deviceId) return res.status(400).json({ success: false, error: 'deviceId required' });
  await DeviceLog.findOneAndUpdate({ userId: req.user._id, deviceId }, { isActive: false });
  await logAudit({
    userId: req.user._id,
    action: 'deactivate',
    targetType: 'device',
    targetId: deviceId,
    details: { deviceId }
  });
  res.json({ success: true });
});

// Owner can deactivate any device for their store's users
router.post('/owner-deactivate', authMiddleware, roleMiddleware('owner'), async (req, res) => {
  const { userId, deviceId } = req.body;
  if (!userId || !deviceId) return res.status(400).json({ success: false, error: 'userId and deviceId required' });
  const device = await DeviceLog.findOneAndUpdate({ userId, deviceId }, { isActive: false });
  if (!device) return res.status(404).json({ success: false, error: 'Device not found' });
  // Audit log
  await logAudit({
    userId: req.user._id,
    action: 'owner-deactivate',
    targetType: 'device',
    targetId: deviceId,
    details: { deactivatedUser: userId, deviceId }
  });
  res.json({ success: true });
});

module.exports = router;
