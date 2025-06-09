const bcrypt = require('bcryptjs');

// Middleware to hash password
const hashPassword = async (req, res, next) => {
  try {
    if (req.body.password) {
      const salt = await bcrypt.genSalt(10);
      req.body.password = await bcrypt.hash(req.body.password, salt);
    }
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error hashing password'
    });
  }
};

// Middleware to validate password strength
const validatePassword = (req, res, next) => {
  const { password } = req.body;
  
  if (!password) {
    return res.status(400).json({
      success: false,
      error: 'Password is required'
    });
  }
  
  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      error: 'Password must be at least 6 characters long'
    });
  }
  
  // Optional: Add more password strength requirements
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  
  if (!hasUpperCase || !hasLowerCase || !hasNumbers) {
    return res.status(400).json({
      success: false,
      error: 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
    });
  }
  
  next();
};

// Function to compare passwords
const comparePasswords = async (plainPassword, hashedPassword) => {
  return await bcrypt.compare(plainPassword, hashedPassword);
};

// Import auth middleware
const {
  authMiddleware,
  authorize,
  checkOwnerOrStaff,
  adminOnly,
  managerAndAbove,
  staffAndAbove
} = require('./auth');

module.exports = {
  hashPassword,
  validatePassword,
  comparePasswords,
  authMiddleware,
  authorize,
  checkOwnerOrStaff,
  adminOnly,
  managerAndAbove,
  staffAndAbove
};
