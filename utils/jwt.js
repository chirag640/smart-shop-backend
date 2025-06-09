const jwt = require('jsonwebtoken');

// Sign JWT token
const signToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '30d'
  });
};

// Verify JWT token
const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};

// Generate token for user
const generateTokenForUser = (user) => {
  return signToken({
    id: user._id,
    email: user.email,
    role: user.role
  });
};

module.exports = {
  signToken,
  verifyToken,
  generateTokenForUser
};
