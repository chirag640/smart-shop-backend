const mongoose = require('mongoose');

const deviceLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  deviceId: {
    type: String,
    required: true,
    index: true
  },
  deviceModel: {
    type: String,
    required: true
  },
  platform: {
    type: String,
    required: true
  },
  token: {
    type: String,
    default: null
  },
  loginAt: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  }
});

deviceLogSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

const DeviceLog = mongoose.model('DeviceLog', deviceLogSchema);

module.exports = DeviceLog;
