require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const connectDB = require('./config/database');

// Try to import errorHandler, use fallback if it doesn't exist
let errorHandler;
try {
  const middlewares = require('./middleware/errorHandler');
  errorHandler = middlewares.errorHandler || middlewares.globalErrorHandler;
} catch (err) {
  errorHandler = (err, req, res, next) => {
    res.status(500).json({ success: false, error: 'Server Error' });
  };
}

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.log('UNCAUGHT EXCEPTION! 💥 Shutting down...');
  console.log(err.name, err.message);
  process.exit(1);
});

// Connect to database
connectDB();

const app = express();

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Enable CORS
app.use(cors());

// Import routes
const authRoutes = require('./routes/auth');
const inventoryRoutes = require('./routes/inventoryRoutes');


// Basic route
app.get('/', (req, res) => {
  res.json({ message: 'Smart Shop API v2' });
});

// Mount routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/inventory', inventoryRoutes);

// Error handler middleware (must be last)
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Error: ${err.message}`);
  server.close(() => {
    process.exit(1);
  });
});
