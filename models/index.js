const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    const logger = require('../utils/logger');
    logger.info({ host: conn.connection.host }, 'MongoDB connected');
  } catch (error) {
    const logger = require('../utils/logger');
    logger.fatal({ err: error }, 'Database connection error');
    process.exit(1);
  }
};

// Handle connection events
mongoose.connection.on('disconnected', () => {
  const logger = require('../utils/logger');
  logger.warn('MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  const logger = require('../utils/logger');
  logger.error({ err }, 'MongoDB connection error');
});

// Central export file for all models
const User = require('./User');
const Store = require('./Store');
const Category = require('./Category');
const InventoryItem = require('./InventoryItem');
const OTP = require('./OTP');
const OTPRateLimit = require('./OTPRateLimit');
const Sale = require('./Sale');
const BusinessPartner = require('./BusinessPartner');

// Export all models
module.exports = {
  connectDB,
  User,
  Store,
  Category,
  InventoryItem,
  OTP,
  OTPRateLimit,
  Sale,
  BusinessPartner
};
