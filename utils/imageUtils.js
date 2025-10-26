const cloudinary = require('../config/cloudinary');

// Default fallback images by category
const getDefaultImageUrl = (type = 'other') => {
  const defaultImages = {
    electronics: 'https://res.cloudinary.com/demo/image/upload/v1/smart-shop/defaults/electronics-default.jpg',
    clothing: 'https://res.cloudinary.com/demo/image/upload/v1/smart-shop/defaults/clothing-default.jpg',
    books: 'https://res.cloudinary.com/demo/image/upload/v1/smart-shop/defaults/books-default.jpg',
    home: 'https://res.cloudinary.com/demo/image/upload/v1/smart-shop/defaults/home-default.jpg',
    sports: 'https://res.cloudinary.com/demo/image/upload/v1/smart-shop/defaults/sports-default.jpg',
    beauty: 'https://res.cloudinary.com/demo/image/upload/v1/smart-shop/defaults/beauty-default.jpg',
    toys: 'https://res.cloudinary.com/demo/image/upload/v1/smart-shop/defaults/toys-default.jpg',
    automotive: 'https://res.cloudinary.com/demo/image/upload/v1/smart-shop/defaults/automotive-default.jpg',
    food: 'https://res.cloudinary.com/demo/image/upload/v1/smart-shop/defaults/food-default.jpg',
    other: 'https://res.cloudinary.com/demo/image/upload/v1/smart-shop/defaults/product-default.jpg'
  };

  return defaultImages[type] || defaultImages.other;
};

// Upload image to Cloudinary with error handling
const uploadToCloudinary = async (filePath, options = {}) => {
  try {
    const defaultOptions = {
      folder: 'smart-shop/inventory',
      transformation: [
        { width: 800, height: 800, crop: 'limit', quality: 'auto:good' },
        { format: 'webp' }
      ],
      resource_type: 'image',
      ...options
    };

    const result = await cloudinary.uploader.upload(filePath, defaultOptions);
    
    return {
      success: true,
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
      version: result.version
    };
  } catch (error) {
    const logger = require('./logger');
    logger.error({ err: error }, 'Cloudinary upload error');
    throw new Error(`Image upload failed: ${error.message}`);
  }
};

// Delete image from Cloudinary
const deleteFromCloudinary = async (publicId) => {
  try {
    if (!publicId) {
      return { success: false, message: 'No public ID provided' };
    }

    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image'
    });
    
  const logger = require('./logger');
  logger.info({ publicId, result: result.result }, 'Cloudinary deletion result');
    
    return {
      success: result.result === 'ok' || result.result === 'not found',
      result: result.result,
      message: result.result === 'not found' ? 'Image already deleted' : 'Image deleted successfully'
    };
  } catch (error) {
    const logger = require('./logger');
    logger.error({ err: error }, 'Cloudinary delete error');
    // Don't throw error for deletion failures - log and continue
    return {
      success: false,
      error: error.message,
      message: 'Failed to delete image from Cloudinary'
    };
  }
};

// Get image details from Cloudinary
const getImageDetails = async (publicId) => {
  try {
    const result = await cloudinary.api.resource(publicId, {
      resource_type: 'image'
    });
    
    return {
      success: true,
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
      createdAt: result.created_at,
      version: result.version
    };
  } catch (error) {
    const logger = require('./logger');
    logger.error({ err: error }, 'Cloudinary get details error');
    return {
      success: false,
      error: error.message
    };
  }
};

// Extract public ID from Cloudinary URL
const extractPublicIdFromUrl = (cloudinaryUrl) => {
  try {
    if (!cloudinaryUrl || typeof cloudinaryUrl !== 'string') {
      return null;
    }
    
    // Handle both Cloudinary URLs and local development URLs
    if (!cloudinaryUrl.includes('cloudinary.com') && !cloudinaryUrl.includes('res.cloudinary.com')) {
      return null;
    }
    
    // Extract public ID from URL
    const urlParts = cloudinaryUrl.split('/');
    const uploadIndex = urlParts.findIndex(part => part === 'upload');
    
    if (uploadIndex === -1) return null;
    
    // Get everything after version number (if exists)
    let publicIdParts = urlParts.slice(uploadIndex + 1);
    
    // Remove version if exists (starts with 'v' followed by numbers)
    if (publicIdParts[0] && /^v\d+$/.test(publicIdParts[0])) {
      publicIdParts = publicIdParts.slice(1);
    }
    
    // Join remaining parts and remove file extension
    const publicId = publicIdParts.join('/').replace(/\.[^/.]+$/, '');
    
    return publicId || null;
  } catch (error) {
    const logger = require('./logger');
    logger.error({ err: error }, 'Error extracting public ID');
    return null;
  }
};

// Generate transformation URLs for different sizes
const generateImageVariants = (publicId) => {
  if (!publicId) return {};
  
  try {
    return {
      thumbnail: cloudinary.url(publicId, {
        width: 150,
        height: 150,
        crop: 'fill',
        quality: 'auto:eco',
        format: 'webp'
      }),
      small: cloudinary.url(publicId, {
        width: 300,
        height: 300,
        crop: 'limit',
        quality: 'auto:good',
        format: 'webp'
      }),
      medium: cloudinary.url(publicId, {
        width: 600,
        height: 600,
        crop: 'limit',
        quality: 'auto:good',
        format: 'webp'
      }),
      large: cloudinary.url(publicId, {
        width: 1200,
        height: 1200,
        crop: 'limit',
        quality: 'auto:good',
        format: 'webp'
      }),
      original: cloudinary.url(publicId, {
        quality: 'auto',
        format: 'webp'
      })
    };
  } catch (error) {
    const logger = require('./logger');
    logger.error({ err: error }, 'Error generating image variants');
    return {};
  }
};

// Generate optimized transformation URL
const generateOptimizedUrl = (publicId, options = {}) => {
  try {
    const defaultOptions = {
      width: 400,
      height: 400,
      crop: 'fill',
      quality: 'auto',
      format: 'webp',
      ...options
    };
    
    return cloudinary.url(publicId, defaultOptions);
  } catch (error) {
    const logger = require('./logger');
    logger.error({ err: error }, 'Error generating optimized URL');
    return null;
  }
};

// Validate uploaded file
const validateImageFile = (file) => {
  const errors = [];
  
  if (!file) {
    return { isValid: true, errors: [] }; // Optional field
  }
  
  // Check file size (5MB limit)
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size && file.size > maxSize) {
    errors.push('File size exceeds 5MB limit');
  }
  
  // Check file type
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  if (file.mimetype && !allowedTypes.includes(file.mimetype)) {
    errors.push('Invalid file type. Only JPEG, PNG, WEBP, and GIF are allowed');
  }
  
  // Check file extension
  if (file.originalname) {
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const fileExtension = file.originalname.toLowerCase().match(/\.[^/.]+$/);
    if (!fileExtension || !allowedExtensions.includes(fileExtension[0])) {
      errors.push('Invalid file extension');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

// Handle image upload with fallback
const handleImageUpload = async (file, itemType = 'other', existingPublicId = null) => {
  try {
    let imageData = {
      imageUrl: getDefaultImageUrl(itemType),
      imagePublicId: null,
      imageVariants: {},
      isDefaultImage: true
    };

    // If file is provided, try to upload it
    if (file) {
      const validation = validateImageFile(file);
      if (!validation.isValid) {
        const logger = require('./logger');
        logger.warn({ errors: validation.errors }, 'Image validation failed');
        return imageData; // Return default image data
      }

      try {
        // Delete existing image if updating
        if (existingPublicId) {
          await deleteFromCloudinary(existingPublicId);
        }

        // Upload new image
        const uploadResult = await uploadToCloudinary(file.path || file.buffer);
        
        if (uploadResult.success) {
          imageData = {
            imageUrl: uploadResult.url,
            imagePublicId: uploadResult.publicId,
            imageVariants: generateImageVariants(uploadResult.publicId),
            isDefaultImage: false,
            imageMetadata: {
              width: uploadResult.width,
              height: uploadResult.height,
              format: uploadResult.format,
              bytes: uploadResult.bytes
            }
          };
          const logger = require('./logger');
          logger.info({ url: uploadResult.url }, 'Image uploaded successfully');
        }
      } catch (uploadError) {
        const logger = require('./logger');
        logger.error({ err: uploadError }, 'Image upload failed, using default');
        // Continue with default image
      }
    }

    return imageData;
  } catch (error) {
    const logger = require('./logger');
    logger.error({ err: error }, 'Error in handleImageUpload');
    // Return default image data on any error
    return {
      imageUrl: getDefaultImageUrl(itemType),
      imagePublicId: null,
      imageVariants: {},
      isDefaultImage: true
    };
  }
};

// Clean up orphaned images (for maintenance)
const cleanupOrphanedImages = async () => {
  try {
    // This would be used for periodic cleanup of unused images
  const logger = require('./logger');
  logger.info('Starting orphaned image cleanup');
    
    // Implementation would involve:
    // 1. Get all images in the smart-shop/inventory folder
    // 2. Compare with database records
    // 3. Delete images not referenced in database
    
    logger.info('Orphaned image cleanup completed');
  } catch (error) {
    const logger = require('./logger');
    logger.error({ err: error }, 'Orphaned image cleanup failed');
  }
};

module.exports = {
  getDefaultImageUrl,
  uploadToCloudinary,
  deleteFromCloudinary,
  getImageDetails,
  extractPublicIdFromUrl,
  generateImageVariants,
  generateOptimizedUrl,
  validateImageFile,
  handleImageUpload,
  cleanupOrphanedImages
};
