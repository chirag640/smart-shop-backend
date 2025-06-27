const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const { authMiddleware, roleMiddleware } = require('../middlewares/auth');

// Get settings for a store
router.get('/:storeId', authMiddleware, async (req, res) => {
  const { storeId } = req.params;
  const settings = await Settings.findOne({ storeId });
  if (!settings) return res.status(404).json({ success: false, error: 'Settings not found' });
  res.json({ success: true, settings });
});

// Update settings for a store (owner only)
router.put('/:storeId', authMiddleware, roleMiddleware('owner'), async (req, res) => {
  const { storeId } = req.params;
  const update = req.body;
  const settings = await Settings.findOneAndUpdate(
    { storeId },
    update,
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  res.json({ success: true, settings });
});

module.exports = router;
