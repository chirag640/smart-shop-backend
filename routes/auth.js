const express = require('express');
const {
  register,
  verifyOTP,
  login,
  getMe,
  resendOTP
} = require('../controllers/authController');
const { authMiddleware } = require('../middlewares/auth');
const { validateUserRegistration, validateOTP } = require('../middleware/validation');
const { authLimiter, customOTPLimiter } = require('../middlewares/rateLimiter');
const { catchAsync } = require('../middleware/errorHandler');

const router = express.Router();

// @route   POST /api/v1/auth/register
// @desc    Register user
// @access  Public
router.post('/register',
  authLimiter,
  validateUserRegistration,
  catchAsync(register)
);

// @route   POST /api/v1/auth/verify-otp
// @desc    Verify OTP
// @access  Public
router.post('/verify-otp',
  authLimiter,
  validateOTP,
  catchAsync(verifyOTP)
);

// @route   POST /api/v1/auth/login
// @desc    Login user
// @access  Public
router.post('/login',
  authLimiter,
  catchAsync(login)
);

// @route   GET /api/v1/auth/me
// @desc    Get current user
// @access  Private
router.get('/me',
  authMiddleware,
  catchAsync(getMe)
);

// @route   POST /api/v1/auth/resend-otp
// @desc    Resend OTP
// @access  Public
router.post('/resend-otp',
  customOTPLimiter,
  catchAsync(resendOTP)
);

module.exports = router;
