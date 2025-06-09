const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
const configureCloudinary = () => {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });

  // Verify configuration
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    if (process.env.NODE_ENV !== 'development') {
      throw new Error('Cloudinary credentials are required in production');
    }
    console.warn('⚠️  Cloudinary credentials not configured - image uploads will be disabled');
  } else {
    console.log('✅ Cloudinary configured successfully');
  }
};

// Initialize configuration
configureCloudinary();

module.exports = cloudinary;
