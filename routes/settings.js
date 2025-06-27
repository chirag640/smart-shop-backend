const express = require('express');
const router = express.Router();
const Store = require('../models/Store');
const { authMiddleware, roleMiddleware } = require('../middlewares/auth');

// Get staff permissions for current user's store
router.get('/staff-permissions', authMiddleware, roleMiddleware('owner'), async (req, res) => {
  const storeId = req.user.storeId;
  const store = await Store.findById(storeId, 'staffPermissions');
  if (!store) return res.status(404).json({ success: false, error: 'Store not found' });
  res.json({ success: true, staffPermissions: store.staffPermissions });
});

// Update staff permissions for current user's store
router.put('/staff-permissions', authMiddleware, roleMiddleware('owner'), async (req, res) => {
  const storeId = req.user.storeId;
  const { canAddExpenses, canEditInventory, canViewCost } = req.body;
  const store = await Store.findById(storeId);
  if (!store) return res.status(404).json({ success: false, error: 'Store not found' });
  if (typeof canAddExpenses === 'boolean') store.staffPermissions.canAddExpenses = canAddExpenses;
  if (typeof canEditInventory === 'boolean') store.staffPermissions.canEditInventory = canEditInventory;
  if (typeof canViewCost === 'boolean') store.staffPermissions.canViewCost = canViewCost;
  await store.save();
  res.json({ success: true, staffPermissions: store.staffPermissions });
});

module.exports = router;
