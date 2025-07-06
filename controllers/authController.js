const { User, Store, OTP } = require('../models');
const { sendOTPEmail, sendWelcomeEmail } = require('../utils/emailService');
const { generateTokenForUser } = require('../utils/jwt');
const { catchAsync, AppError } = require('../middleware/errorHandler');

// @desc    Register user (Step 1: Send OTP)
// @route   POST /api/v1/auth/register
// @access  Public
const register = catchAsync(async (req, res, next) => {
  const { email, password, firstName, lastName, phoneNumber, role, storeId } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    return next(new AppError('User with this email already exists', 409));
  }

  // Validate role and store association
  if (role && !['customer', 'staff', 'owner'].includes(role)) {
    return next(new AppError('Invalid role specified', 400));
  }

  if (role && ['staff', 'owner'].includes(role) && !storeId) {
    return next(new AppError('Store ID is required for staff and owner roles', 400));
  }

  // Store registration data temporarily in OTP record
  const registrationData = {
    email: email.toLowerCase(),
    password,
    firstName,
    lastName,
    phoneNumber,
    role: role || 'customer',
    ...(storeId && { storeId })
  };

  // Generate and send OTP with registration data
  const otpRecord = await OTP.createRegistrationOTP(
    email.toLowerCase(),
    registrationData,
    req.ip,
    req.get('User-Agent')
  );

  try {
    await sendOTPEmail(email, otpRecord.otp);
  } catch (emailError) {
    console.error('Failed to send OTP email:', emailError);
    return next(new AppError('Failed to send verification email. Please try again.', 500));
  }

  res.status(200).json({
    success: true,
    message: 'Verification code sent to your email. Please verify to complete registration.',
    data: {
      email: email.toLowerCase(),
      otpSent: true,
      expiresIn: '10 minutes'
    }
  });
});

// @desc    Verify OTP and Complete Registration
// @route   POST /api/v1/auth/verify-otp
// @access  Public
const verifyOTP = catchAsync(async (req, res, next) => {
  const { email, otp } = req.body;

  // Find valid OTP
  const otpRecord = await OTP.findValidOTP(email.toLowerCase(), otp, 'email_verification');
  
  if (!otpRecord) {
    return next(new AppError('Invalid or expired OTP', 400));
  }

  // Increment attempts
  await otpRecord.incrementAttempts();

  // Check if this is a registration OTP with user data
  if (otpRecord.registrationData) {
    // This is a registration verification - create the user now
    const userData = otpRecord.registrationData;
    userData.isEmailVerified = true;
    userData.isActive = true;

    // Create user
    const user = await User.create(userData);

    // Mark OTP as verified
    await otpRecord.markAsVerified();

    // Generate JWT token
    const token = user.generateJWT();

    // Send welcome email
    try {
      await sendWelcomeEmail(email, {
        loginUrl: `${process.env.FRONTEND_URL}/login`
      });
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
    }

    res.status(201).json({
      success: true,
      message: 'Registration completed successfully',
      data: {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isEmailVerified: user.isEmailVerified
        },
        token
      }
    });
  } else {
    // This is a regular email verification for existing user
    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    // Mark OTP as verified
    await otpRecord.markAsVerified();

    // Update user verification status
    user.isEmailVerified = true;
    await user.save();

    // Generate JWT token
    const token = user.generateJWT();

    res.status(200).json({
      success: true,
      message: 'Email verified successfully',
      data: {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isEmailVerified: user.isEmailVerified
        },
        token
      }
    });
  }
});

// @desc    Login user
// @route   POST /api/v1/auth/login
// @access  Public
const login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }

  // Find user with password
  const user = await User.findByEmail(email);
  
  if (!user) {
    return next(new AppError('Invalid credentials', 401));
  }

  // Check if account is locked
  if (user.isLocked) {
    return next(new AppError('Account temporarily locked due to too many failed login attempts', 423));
  }

  // Check if account is active
  if (!user.isActive) {
    return next(new AppError('Account is deactivated', 403));
  }

  // Verify password
  const isPasswordCorrect = await user.comparePassword(password);
  
  if (!isPasswordCorrect) {
    await user.incrementLoginAttempts();
    return next(new AppError('Invalid credentials', 401));
  }

  // Reset login attempts on successful login
  await user.resetLoginAttempts();

  // Generate JWT token
  const token = user.generateJWT();

  res.status(200).json({
    success: true,
    message: 'Login successful',
    data: {
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        storeId: user.storeId,
        isEmailVerified: user.isEmailVerified
      },
      token
    }
  });
});

// @desc    Get current user
// @route   GET /api/v1/auth/me
// @access  Private
const getMe = catchAsync(async (req, res) => {
  const user = await User.findById(req.user.id)
    .populate('storeId', 'name location')
    .select('-password');

  res.status(200).json({
    success: true,
    data: { user }
  });
});

// @desc    Resend OTP
// @route   POST /api/v1/auth/resend-otp
// @access  Public
const resendOTP = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  // Check if there's a pending registration OTP
  const existingOTP = await OTP.findOne({ 
    email: email.toLowerCase(), 
    type: 'email_verification',
    verified: false,
    registrationData: { $exists: true }
  });

  if (existingOTP) {
    // This is for a pending registration - resend OTP with the same registration data
    const otpRecord = await OTP.createRegistrationOTP(
      email.toLowerCase(),
      existingOTP.registrationData,
      req.ip,
      req.get('User-Agent')
    );

    try {
      await sendOTPEmail(email, otpRecord.otp);
    } catch (emailError) {
      console.error('Failed to send OTP email:', emailError);
      return next(new AppError('Failed to send verification email. Please try again.', 500));
    }

    return res.status(200).json({
      success: true,
      message: 'Verification code resent to your email'
    });
  }

  // Check if user exists (for existing user email verification)
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    return next(new AppError('No pending registration or user found for this email', 404));
  }

  // Check if already verified
  if (user.isEmailVerified) {
    return next(new AppError('Email already verified', 400));
  }

  // Generate new OTP for existing user
  const otpRecord = await OTP.createOTP(
    email.toLowerCase(),
    'email_verification',
    req.ip,
    req.get('User-Agent')
  );

  // Send OTP email
  await sendOTPEmail(email, otpRecord.otp);

  res.status(200).json({
    success: true,
    message: 'OTP sent successfully'
  });
});

module.exports = {
  register,
  verifyOTP,
  login,
  getMe,
  resendOTP
};
