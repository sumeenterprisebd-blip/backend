const cloudinary = require("cloudinary").v2;

// Validate Cloudinary configuration
const validateCloudinaryConfig = () => {
  const errors = [];

  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    errors.push("CLOUDINARY_CLOUD_NAME is not set");
  }
  if (!process.env.CLOUDINARY_API_KEY) {
    errors.push("CLOUDINARY_API_KEY is not set");
  }
  if (!process.env.CLOUDINARY_API_SECRET) {
    errors.push("CLOUDINARY_API_SECRET is not set");
  }

  if (errors.length > 0) {
    errors.forEach((error) => console.error(`   - ${error}`));
    return false;
  }

  return true;
};

// Configure Cloudinary
if (validateCloudinaryConfig()) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
} else {
}

// Get Cloudinary signature for frontend upload
const getSignature = (uploadFolder = null) => {
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new Error(
      "Cloudinary configuration is missing. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your .env file."
    );
  }

  const timestamp = Math.round(new Date().getTime() / 1000);
  // Allow dynamic folder or default to heroes
  const folder = uploadFolder || "drip_drop/heroes";

  // Parameters to sign (must match exactly what client sends)
  const paramsToSign = {
    timestamp: timestamp,
    folder: folder,
  };

  // Generate signature using Cloudinary's signing method
  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    process.env.CLOUDINARY_API_SECRET
  );

  return {
    signature,
    timestamp,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    folder: folder,
  };
};

// Delete image from Cloudinary
const deleteImage = async (publicId) => {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
  }
};

module.exports = {
  cloudinary,
  getSignature,
  deleteImage,
};
