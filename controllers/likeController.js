const ProductLike = require("../models/ProductLike");
const Product = require("../models/Product");

// Generate guest identifier from IP and user agent
const generateGuestId = (ipAddress, userAgent) => {
  const crypto = require("crypto");
  const safeIp = ipAddress || "unknown-ip";
  const safeUserAgent = userAgent || "unknown-agent";
  return crypto
    .createHash("sha256")
    .update(safeIp + safeUserAgent)
    .digest("hex")
    .substring(0, 32);
};

// @desc    Add/increment like for a product
// @route   POST /api/likes/:productId
// @access  Public
exports.likeProduct = async (req, res) => {
  try {
    const { productId } = req.params;

    // Verify product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Get user identifier
    const ipAddress = req.ip || req.connection?.remoteAddress || "127.0.0.1";
    const userAgent = req.headers["user-agent"] || "unknown";

    const identifier = {
      userId: req.user ? req.user.id : null,
      guestId: req.user ? null : generateGuestId(ipAddress, userAgent),
    };

    // Check if can like
    const canLikeCheck = await ProductLike.canLike(productId, identifier);
    if (!canLikeCheck.canLike) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${canLikeCheck.maxLikes} likes reached for this product`,
        currentCount: canLikeCheck.currentCount,
        maxLikes: canLikeCheck.maxLikes,
      });
    }

    // Add like
    const like = await ProductLike.addLike(
      productId,
      identifier,
      ipAddress,
      userAgent
    );

    res.status(200).json({
      success: true,
      message: "Product liked successfully",
      likeCount: like.likeCount,
      canLikeMore: like.likeCount < 5,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to like product",
      error: error.message,
    });
  }
};

// @desc    Get like count for a product
// @route   GET /api/likes/:productId
// @access  Public
exports.getLikeCount = async (req, res) => {
  try {
    const { productId } = req.params;

    // Get user identifier
    const ipAddress = req.ip || req.connection?.remoteAddress || "127.0.0.1";
    const userAgent = req.headers["user-agent"] || "unknown";

    const identifier = {
      userId: req.user ? req.user.id : null,
      guestId: req.user ? null : generateGuestId(ipAddress, userAgent),
    };

    // Get total likes for this user/guest
    const likeCount = await ProductLike.getTotalLikes(productId, identifier);

    // Check if can like more
    const canLikeCheck = await ProductLike.canLike(productId, identifier);

    res.status(200).json({
      success: true,
      likeCount,
      canLikeMore: canLikeCheck.canLike,
      maxLikes: 5,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get like count",
      error: error.message,
    });
  }
};

// @desc    Check if combo offer applies
// @route   POST /api/likes/check-combo
// @access  Public
exports.checkComboOffer = async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body;

    // Validate input
    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required",
      });
    }

    // Validate ObjectId format
    const mongoose = require("mongoose");
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID format",
      });
    }

    // Verify product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Combo/Free delivery is now managed per-product (Admin Products -> Combo Offer).
    // If the product isn't marked as a combo offer, it can't grant free delivery.
    if (!product.isComboOffer) {
      return res.status(200).json({
        success: true,
        comboApplied: false,
        freeDelivery: false,
        reason: "No combo offer for this product",
        settings: { minQuantity: null, minLikes: null },
        current: { quantity, likeCount: 0 },
        quantityQualifies: false,
        likesQualify: false,
      });
    }

    const minQuantity =
      typeof product.freeDeliveryMinQty === "number" && product.freeDeliveryMinQty >= 1
        ? product.freeDeliveryMinQty
        : 2;

    const quantityQualifies = Number(quantity) >= minQuantity;
    const freeDelivery = !!product.freeDelivery && quantityQualifies;
    const comboApplied = freeDelivery;

    return res.status(200).json({
      success: true,
      comboApplied,
      freeDelivery,
      reason: freeDelivery
        ? `${quantity} items qualify for free delivery`
        : product.freeDelivery
          ? `Need ${minQuantity}+ items for free delivery`
          : "Combo offer does not include free delivery",
      settings: {
        minQuantity,
        minLikes: null,
      },
      current: {
        quantity,
        likeCount: 0,
      },
      quantityQualifies,
      likesQualify: false,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to check combo offer",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Internal server error",
    });
  }
};
