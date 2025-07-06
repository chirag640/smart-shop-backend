require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const connectDB = require('./config/database');
const { applySecurity } = require('./middleware/security');

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


// Enable CORS for all routes and origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
}));

// Apply comprehensive security middleware
applySecurity(app);

// Body parser middleware (with size limits)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// Import routes
const authRoutes = require('./routes/auth');
const inventoryRoutes = require('./routes/inventoryRoutes');
const storeRoutes = require('./routes/stores');
const categoryRoutes = require('./routes/categories');
const customerRoutes = require('./routes/customers');
const billingRoutes = require('./routes/billing');
const partnerRoutes = require('./routes/partners');
const expenseRoutes = require('./routes/expenses');
const reportRoutes = require('./routes/reports');
const profitLossRoutes = require('./routes/profitLoss');
const inventoryReportRoutes = require('./routes/inventoryReports');
const salesCalendarRoutes = require('./routes/salesCalendar');
const customerReportRoutes = require('./routes/customerReports');
const returnsReportRoutes = require('./routes/returnsReport');
const syncRoutes = require('./routes/sync');
const settingsRoutes = require('./routes/settings');
const usersRoutes = require('./routes/users');
const notificationsRoutes = require('./routes/notifications');
const fcmRoutes = require('./routes/fcm');
const settingsAppRoutes = require('./routes/settingsApp');
const backupRoutes = require('./routes/backup');
const auditRoutes = require('./routes/audit');
const pinRoutes = require('./routes/pin');
const devicesRoutes = require('./routes/devices');

// Basic route
app.get('/', (req, res) => {
  res.json({ message: 'Smart Shop API v2' });
});

// Mount routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/inventory', inventoryRoutes);
app.use('/api/v1/stores', storeRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/billing', billingRoutes);
app.use('/api/v1/partners', partnerRoutes);
app.use('/api/v1/expenses', expenseRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/reports', profitLossRoutes);
app.use('/api/v1/reports/inventory', inventoryReportRoutes);
app.use('/api/v1/reports/sales-calendar', salesCalendarRoutes);
app.use('/api/v1/reports/customers', customerReportRoutes);
app.use('/api/v1/reports', returnsReportRoutes);
app.use('/api/v1/sync', syncRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/notifications', notificationsRoutes);
app.use('/api/v1/fcm', fcmRoutes);
app.use('/api/v1/app-settings', settingsAppRoutes);
app.use('/api/v1/backup', backupRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/pin', pinRoutes);
app.use('/api/v1/devices', devicesRoutes);

// Error handler middleware (must be last)
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Error: ${err.message}`);
  server.close(() => {
    process.exit(1);
  });
});
