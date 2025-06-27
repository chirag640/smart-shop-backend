const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
    unique: true,
    index: true
  },
  storeName: {
    type: String,
    trim: true
  },
  address: {
    type: String,
    trim: true
  },
  contact: {
    type: String,
    trim: true
  },
  invoiceFooter: {
    type: String,
    trim: true
  },
  enableLoyaltyPoints: {
    type: Boolean,
    default: false
  },
  enableDailyEmails: {
    type: Boolean,
    default: false
  },
  enableAppPin: {
    type: Boolean,
    default: false
  },
  requirePinForBilling: {
    type: Boolean,
    default: false
  },
  requirePinForReports: {
    type: Boolean,
    default: false
  },
  enableBiometricLock: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

const Settings = mongoose.model('Settings', settingsSchema);

module.exports = Settings;
