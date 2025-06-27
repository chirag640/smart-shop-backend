const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middlewares/auth');
const User = require('../models/User');

// List users for current store (owner only)
router.get('/', authMiddleware, roleMiddleware('owner'), async (req, res) => {
  const storeId = req.user.storeId;
  const users = await User.find({ storeId }).select('-password');
  res.json({ success: true, users });
});

// Promote/demote user (owner only, only one owner allowed)
router.put('/:id/role', authMiddleware, roleMiddleware('owner'), async (req, res) => {
  const { role } = req.body;
  const userId = req.params.id;
  if (!['owner', 'staff', 'manager', 'admin'].includes(role)) {
    return res.status(400).json({ success: false, error: 'Invalid role' });
  }
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  if (role === 'owner') {
    // Demote any existing owner in this store
    await User.updateMany({ storeId: user.storeId, role: 'owner' }, { $set: { role: 'staff' } });
  }
  user.role = role;
  await user.save();
  res.json({ success: true, user });
});

module.exports = router;
