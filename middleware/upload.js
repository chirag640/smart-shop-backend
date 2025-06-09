const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');
const path = require('path');
const { validateImageFile } = require('../utils/imageUtils');

// Cloudinary storage configuration
const cloudinaryStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'smart-shop/inventory',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [
      { width: 1200, height: 1200, crop: 'limit', quality: 'auto:good' },
      { format: 'webp' }
    ],
    public_id: (req, file) => {
      // Generate unique filename with timestamp and random string
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const fileName = file.originalname.replace(/\.[^/.]+$/, '');
      return `item-${fileName}-${uniqueSuffix}`;
    }
  }
});

// Memory storage for development when Cloudinary is not configured
const memoryStorage = multer.memoryStorage();

// Enhanced file filter function
const fileFilter = (req, file, cb) => {
  try {
    // First check if it's an image
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'), false);
    }

    // Validate file using our utility
    const validation = validateImageFile(file);
    if (!validation.isValid) {
      return cb(new Error(validation.errors.join(', ')), false);
    }

    // Additional format validation
    const allowedFormats = ['.jpg', '.jpeg', '.png', '.webp',];
    const fileExt = path.extname(file.originalname).toLowerCase();
    
    if (!allowedFormats.includes(fileExt)) {
      return cb(new Error('Invalid file format. Only JPG, JPEG, PNG, and WEBP are allowed.'), false);
    }

    cb(null, true);
  } catch (error) {
    cb(new Error('File validation failed'), false);
  }
};

// Create multer instance based on environment
const createUploadMiddleware = () => {
  const hasCloudinaryConfig = process.env.CLOUDINARY_CLOUD_NAME && 
                             process.env.CLOUDINARY_API_KEY && 
                             process.env.CLOUDINARY_API_SECRET;

  const storage = hasCloudinaryConfig ? cloudinaryStorage : memoryStorage;

  return multer({
    storage: storage,
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB limit
      files: 1 // Single file upload
    },
    fileFilter: fileFilter
  });
};

// Single image upload middleware
const uploadSingle = createUploadMiddleware().single('image');

// Multiple images upload middleware (for future use)
const uploadMultiple = createUploadMiddleware().array('images', 5);

// Enhanced upload middleware with error handling and fallback
const handleImageUpload = (req, res, next) => {
  uploadSingle(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      let errorMessage = 'Upload error occurred';
      
      switch (err.code) {
        case 'LIMIT_FILE_SIZE':
          errorMessage = 'File too large. Maximum size is 5MB.';
          break;
        case 'LIMIT_FILE_COUNT':
          errorMessage = 'Too many files. Only one image is allowed.';
          break;
        case 'LIMIT_FIELD_COUNT':
          errorMessage = 'Too many fields in upload.';
          break;
        case 'LIMIT_UNEXPECTED_FILE':
          errorMessage = 'Unexpected file field.';
          break;
        default:
          errorMessage = `Upload error: ${err.message}`;
      }
      
      return res.status(400).json({
        success: false,
        error: errorMessage
      });
    } else if (err) {
      return res.status(400).json({
        success: false,
        error: err.message || 'Image upload failed'
      });
    }
    
    // Handle development mode without Cloudinary
    if (!process.env.CLOUDINARY_CLOUD_NAME && req.file && process.env.NODE_ENV === 'development') {
      // Create a mock Cloudinary-like structure for development
      const mockPublicId = `smart-shop/inventory/mock-${Date.now()}`;
      req.file.path = `http://localhost:${process.env.PORT || 5000}/uploads/mock-${Date.now()}.jpg`;
      req.file.cloudinary = {
        public_id: mockPublicId,
        secure_url: req.file.path,
        width: 800,
        height: 600,
        format: 'jpg'
      };
      
      console.log('📷 Mock image URL created for development:', req.file.path);
    }
    
    // Log successful upload
    if (req.file) {
      console.log(`📷 Image upload processed: ${req.file.originalname || 'Unknown'}`);
    }
    
    next();
  });
};

// Multiple images upload with error handling
const handleMultipleImageUpload = (req, res, next) => {
  uploadMultiple(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      let errorMessage = 'Upload error occurred';
      
      switch (err.code) {
        case 'LIMIT_FILE_SIZE':
          errorMessage = 'One or more files are too large. Maximum size is 5MB per file.';
          break;
        case 'LIMIT_FILE_COUNT':
          errorMessage = 'Too many files. Maximum 5 images allowed.';
          break;
        default:
          errorMessage = `Upload error: ${err.message}`;
      }
      
      return res.status(400).json({
        success: false,
        error: errorMessage
      });
    } else if (err) {
      return res.status(400).json({
        success: false,
        error: err.message || 'Image upload failed'
      });
    }
    
    // Handle development mode for multiple files
    if (!process.env.CLOUDINARY_CLOUD_NAME && req.files && req.files.length > 0 && process.env.NODE_ENV === 'development') {
      req.files.forEach((file, index) => {
        const mockPublicId = `smart-shop/inventory/mock-${Date.now()}-${index}`;
        file.path = `http://localhost:${process.env.PORT || 5000}/uploads/mock-${Date.now()}-${index}.jpg`;
        file.cloudinary = {
          public_id: mockPublicId,
          secure_url: file.path,
          width: 800,
          height: 600,
          format: 'jpg'
        };
      });
      
      console.log(`📷 ${req.files.length} mock image URLs created for development`);
    }
    
    next();
  });
};

// Middleware to check if upload is optional
const optionalImageUpload = (req, res, next) => {
  // Set a flag to indicate this is an optional upload
  req.isOptionalUpload = true;
  handleImageUpload(req, res, next);
};

module.exports = {
  handleImageUpload,
  handleMultipleImageUpload,
  optionalImageUpload,
  uploadSingle,
  uploadMultiple
};
