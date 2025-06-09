const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('Database connection error:', error.message);
    process.exit(1);
  }
};

// Handle connection events
mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
});

// Central export file for all models
const User = require('./User');
const InventoryItem = require('./InventoryItem');
const OTP = require('./OTP');
const OTPRateLimit = require('./OTPRateLimit');

// Export all models
module.exports = {
  connectDB,
  User,
  InventoryItem,
  OTP,
  OTPRateLimit
};
