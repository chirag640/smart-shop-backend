// Middleware to extract deviceId and lastSyncedAt from headers or query
// Usage: Attach to sync routes to populate req.syncContext

const extractSyncContext = (req, res, next) => {
  // deviceId can come from header, query, or body (prefer header)
  const deviceId = req.headers['x-device-id'] || req.query.deviceId || req.body?.deviceId || null;
  // lastSyncedAt can come from query or header (prefer query)
  let lastSyncedAt = req.query.since || req.headers['x-last-synced-at'] || null;

  if (lastSyncedAt) {
    // Try to parse as Date
    const parsed = new Date(lastSyncedAt);
    if (!isNaN(parsed.getTime())) {
      lastSyncedAt = parsed;
    } else {
      lastSyncedAt = null;
    }
  }

  req.syncContext = {
    deviceId,
    lastSyncedAt
  };
  next();
};

module.exports = { extractSyncContext };
