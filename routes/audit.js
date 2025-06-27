const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');
const { authMiddleware, roleMiddleware } = require('../middlewares/auth');

// GET /audit/store/:storeId - Owner only
router.get('/store/:storeId', authMiddleware, roleMiddleware('owner'), async (req, res) => {
  const { storeId } = req.params;
  const logs = await AuditLog.find({ 'details.storeId': storeId }).sort({ timestamp: -1 }).limit(200);
  res.json({ success: true, logs });
});

module.exports = router;
