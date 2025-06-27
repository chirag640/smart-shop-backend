const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { authMiddleware } = require('../middlewares/auth');
const User = require('../models/User');

// Set PIN (store hashed, per user+device)
router.post('/set-pin', authMiddleware, async (req, res) => {
  const { pin, deviceId } = req.body;
  if (!pin || !deviceId) return res.status(400).json({ success: false, error: 'PIN and deviceId required' });
  const hash = await bcrypt.hash(pin, 10);
  req.user.pinHash = hash;
  req.user.pinDeviceId = deviceId;
  await req.user.save();
  res.json({ success: true });
});

// Verify PIN
router.post('/verify-pin', authMiddleware, async (req, res) => {
  const { pin, deviceId } = req.body;
  if (!pin || !deviceId) return res.status(400).json({ success: false, error: 'PIN and deviceId required' });
  if (!req.user.pinHash || req.user.pinDeviceId !== deviceId) {
    return res.status(400).json({ success: false, error: 'PIN not set for this device' });
  }
  const match = await bcrypt.compare(pin, req.user.pinHash);
  res.json({ success: match });
});

// Update PIN
router.post('/update-pin', authMiddleware, async (req, res) => {
  const { oldPin, newPin, deviceId } = req.body;
  if (!oldPin || !newPin || !deviceId) return res.status(400).json({ success: false, error: 'All fields required' });
  if (!req.user.pinHash || req.user.pinDeviceId !== deviceId) {
    return res.status(400).json({ success: false, error: 'PIN not set for this device' });
  }
  const match = await bcrypt.compare(oldPin, req.user.pinHash);
  if (!match) return res.status(400).json({ success: false, error: 'Old PIN incorrect' });
  req.user.pinHash = await bcrypt.hash(newPin, 10);
  await req.user.save();
  res.json({ success: true });
});

module.exports = router;
