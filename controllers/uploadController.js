const { uploadImage, uploadImages } = require('../utils/cloudinary');

// @desc    Upload single image
// @route   POST /api/upload/image
// @access  Private/Admin
exports.uploadImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    const imageUrl = await uploadImage(req.file);
    
    res.status(200).json({
      success: true,
      imageUrl
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Upload multiple images
// @route   POST /api/upload/images
// @access  Private/Admin
exports.uploadImages = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No image files provided'
      });
    }

    const imageUrls = await uploadImages(req.files);
    
    res.status(200).json({
      success: true,
      imageUrls
    });
  } catch (error) {
    next(error);
  }
};

