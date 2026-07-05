const express = require("express");
const { getSignature } = require("../utils/cloudinary");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

// Get Cloudinary upload signature (for frontend direct upload)
router.get("/signature", protect, authorize("admin"), (req, res) => {
  try {
    // Check if Cloudinary is configured
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      // Return 200 with configured: false instead of 400 to avoid frontend error logs
      // Frontend will handle this gracefully and fall back to unsigned uploads
      return res.status(200).json({
        success: false,
        message:
          "Cloudinary is not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your .env file. You can use unsigned uploads by setting NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET in frontend .env.local instead.",
        configured: false,
      });
    }

    // Allow folder to be specified via query parameter
    // e.g., /api/upload/signature?folder=drip_drop/products
    const folder = req.query.folder;
    const signatureData = getSignature(folder);

    res.status(200).json({
      success: true,
      configured: true,
      ...signatureData,
    });
  } catch (error) {
    // Return 200 with error info instead of 500 to avoid frontend error logs
    res.status(200).json({
      success: false,
      message: error.message || "Failed to generate upload signature",
      configured: false,
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

module.exports = router;
