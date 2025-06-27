const admin = require('firebase-admin');
const FCMToken = require('../models/FCMToken');

// Initialize Firebase Admin SDK (ensure service account key is set in env or config)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

/**
 * Send a push notification to all devices for a user
 * @param {Object} opts
 * @param {String} opts.userId
 * @param {String} opts.title
 * @param {String} opts.message
 * @param {Object} [opts.data]
 */
async function sendPushNotification({ userId, title, message, data = {} }) {
  const tokens = await FCMToken.find({ userId }).select('token -_id');
  if (!tokens.length) return;
  const payload = {
    notification: { title, body: message },
    data: { ...data }
  };
  const tokenList = tokens.map(t => t.token);
  await admin.messaging().sendToDevice(tokenList, payload);
}

module.exports = { sendPushNotification };
