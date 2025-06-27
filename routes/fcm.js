const express = require('express');
const router = express.Router();
const FCMToken = require('../models/FCMToken');
const { authMiddleware } = require('../middlewares/auth');

// Register or update FCM token for a user/device
router.post('/register', authMiddleware, async (req, res) => {
  const { deviceId, token } = req.body;
  if (!deviceId || !token) {
    return res.status(400).json({ success: false, error: 'Missing deviceId or token' });
  }
  await FCMToken.findOneAndUpdate(
    { userId: req.user._id, deviceId },
    { token, updatedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  res.json({ success: true });
});

module.exports = router;
