const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
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

module.exports = connectDB;
