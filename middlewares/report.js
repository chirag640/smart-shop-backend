// Middleware to allow staff to view/export reports if toggle is enabled
const allowStaffReports = (req, res, next) => {
  const staffCanView = process.env.STAFF_CAN_VIEW_REPORTS === 'true';
  if (req.user.role === 'staff' && !staffCanView) {
    return res.status(403).json({
      success: false,
      error: 'Staff are not allowed to view or export reports.'
    });
  }
  next();
};

// Middleware to block staff from auto-summaries
const blockStaffAutoSummary = (req, res, next) => {
  if (req.user.role === 'staff') {
    return res.status(403).json({
      success: false,
      error: 'Staff are not allowed to receive auto-summaries.'
    });
  }
  next();
};

module.exports = { allowStaffReports, blockStaffAutoSummary };
