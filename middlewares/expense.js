// Middleware to allow staff to manage expenses if toggle is enabled
const allowStaffExpenseEdit = (req, res, next) => {
  // Example: check a global config or env var
  const staffCanEdit = process.env.STAFF_CAN_MANAGE_EXPENSES === 'true';
  if (req.user.role === 'staff' && !staffCanEdit) {
    return res.status(403).json({
      success: false,
      error: 'Staff are not allowed to add/edit/delete expenses.'
    });
  }
  next();
};

// Middleware to restrict recurring settings to owner only
const recurringOwnerOnly = (req, res, next) => {
  if ('recurring' in req.body || 'interval' in req.body || 'startDate' in req.body || 'endDate' in req.body) {
    if (req.user.role !== 'superadmin' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Only owner/admin can manage recurring expense settings.'
      });
    }
  }
  next();
};

module.exports = { allowStaffExpenseEdit, recurringOwnerOnly };
