const AuditLog = require('../models/AuditLog');

/**
 * Log an audit event
 * @param {Object} opts
 * @param {String} opts.userId - User performing the action
 * @param {String} opts.action - Action performed (e.g., create, update, delete, login, export)
 * @param {String} opts.targetType - Entity type (e.g., customer, inventory, bill, settings)
 * @param {String} [opts.targetId] - Entity ID
 * @param {Object} [opts.details] - Additional details (diff, payload, etc)
 */
async function logAudit({ userId, action, targetType, targetId = null, details = {} }) {
  if (!userId || !action || !targetType) return;
  await AuditLog.create({ userId, action, targetType, targetId, details });
}

module.exports = { logAudit };
