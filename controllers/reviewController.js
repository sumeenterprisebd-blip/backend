const Review = require("../models/Review");
const Order = require("../models/Order");
const Notification = require("../models/Notification");

// @desc    Get approved reviews for a product
// @route   GET /api/reviews/product/:productId
// @access  Public
exports.getProductReviews = async (req, res, next) => {
  try {
    const reviews = await Review.find({
      product: req.params.productId,
      approvalStatus: "approved",
    })
      .populate("user", "firstName lastName avatar")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: reviews.length,
      reviews,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get approved reviews for homepage
// @route   GET /api/reviews/public
// @access  Public
exports.getPublicReviews = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const reviews = await Review.find({
      approvalStatus: "approved",
    })
      .populate("user", "firstName lastName avatar")
      .populate("product", "name images")
      .sort({ createdAt: -1 })
      .limit(limit);

    res.status(200).json({
      success: true,
      count: reviews.length,
      reviews,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create review (requires order)
// @route   POST /api/reviews
// @access  Private
exports.createReview = async (req, res, next) => {
  try {
    const { orderId, productId, rating, comment } = req.body;

    // Validate required fields
    if (!orderId || !productId || !rating) {
      return res.status(400).json({
        success: false,
        message: "Order ID, Product ID, and Rating are required",
      });
    }

    // Verify order exists and belongs to user, and is delivered
    const order = await Order.findOne({
      _id: orderId,
      user: req.user.id,
      orderStatus: "delivered",
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found or not delivered yet",
      });
    }

    // Verify product is in the order
    const productInOrder = order.orderItems.some(
      (item) => item.product.toString() === productId
    );

    if (!productInOrder) {
      return res.status(400).json({
        success: false,
        message: "This product is not in the specified order",
      });
    }

    // Check if review already exists for this order
    const existingReview = await Review.findOne({
      user: req.user.id,
      order: orderId,
      product: productId,
    });

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: "You have already reviewed this product for this order",
      });
    }

    // Create review with pending status
    const review = await Review.create({
      user: req.user.id,
      product: productId,
      order: orderId,
      rating,
      comment: comment || "",
      approvalStatus: "pending",
      isVerified: true,
    });

    await review.populate("user", "firstName lastName avatar");
    await review.populate("product", "name");

    try {
      await Notification.create({
        recipientType: "admin",
        type: "review",
        title: "New product review submitted",
        message: `New review for ${String(review.product?.name || "a product")} posted by ${String(review.user?.firstName || "").trim()} ${String(review.user?.lastName || "").trim()}`.trim(),
        referenceId: String(review._id),
        data: {
          reviewId: String(review._id),
          productId: String(review.product?._id || review.product),
          orderId: String(review.order || ""),
          userId: String(review.user?._id || review.user),
          rating: Number(review.rating || 0),
        },
      });
    } catch {
      // Best-effort only
    }

    res.status(201).json({
      success: true,
      message:
        "Review submitted successfully. It will be published after admin approval.",
      review,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update review
// @route   PUT /api/reviews/:id
// @access  Private
exports.updateReview = async (req, res, next) => {
  try {
    let review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    // Allow user to update their own review OR admin to update any review
    if (review.user.toString() !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this review",
      });
    }

    // If admin is updating, allow changing approvalStatus
    // If user is updating, only allow rating and comment changes
    const updateData =
      req.user.role === "admin"
        ? req.body
        : { rating: req.body.rating, comment: req.body.comment };

    review = await Review.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    })
      .populate("user", "firstName lastName avatar")
      .populate("product", "name images");

    res.status(200).json({
      success: true,
      message: "Review updated successfully",
      review,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete review
// @route   DELETE /api/reviews/:id
// @access  Private
exports.deleteReview = async (req, res, next) => {
  try {
    const review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    // Make sure user owns the review or is admin
    if (review.user.toString() !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this review",
      });
    }

    await review.deleteOne();

    res.status(200).json({
      success: true,
      message: "Review deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get pending reviews (Admin only)
// @route   GET /api/reviews/pending
// @access  Private/Admin
exports.getPendingReviews = async (req, res, next) => {
  try {
    const reviews = await Review.find({ approvalStatus: "pending" })
      .populate("user", "firstName lastName avatar")
      .populate("product", "name images")
      .populate("order", "orderItems")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: reviews.length,
      reviews,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Check if review exists for order/product (for customer)
// @route   GET /api/reviews/check/:orderId/:productId
// @access  Private
exports.checkReviewExists = async (req, res, next) => {
  try {
    const { orderId, productId } = req.params;

    const review = await Review.findOne({
      user: req.user.id,
      order: orderId,
      product: productId,
    });

    res.status(200).json({
      success: true,
      exists: !!review,
      review: review || null,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Approve review (Admin only)
// @route   PUT /api/reviews/:id/approve
// @access  Private/Admin
exports.approveReview = async (req, res, next) => {
  try {
    const review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    review.approvalStatus = "approved";
    await review.save();

    await review.populate("user", "firstName lastName avatar");
    await review.populate("product", "name");

    res.status(200).json({
      success: true,
      message: "Review approved successfully",
      review,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reject review (Admin only)
// @route   PUT /api/reviews/:id/reject
// @access  Private/Admin
exports.rejectReview = async (req, res, next) => {
  try {
    const review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    review.approvalStatus = "rejected";
    await review.save();

    res.status(200).json({
      success: true,
      message: "Review rejected successfully",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Admin create review manually
// @route   POST /api/reviews/admin
// @access  Private/Admin
exports.adminCreateReview = async (req, res, next) => {
  try {
    const {
      userId,
      productId,
      orderId,
      rating,
      comment,
      autoApprove = true,
      // New user fields
      newUserFirstName,
      newUserLastName,
      newUserEmail,
    } = req.body;

    // Validate required fields
    if (!productId || !rating) {
      return res.status(400).json({
        success: false,
        message: "Product ID and Rating are required",
      });
    }

    // Either userId OR new user details must be provided
    if (!userId && !newUserFirstName) {
      return res.status(400).json({
        success: false,
        message: "Either User ID or new user first name is required",
      });
    }

    const User = require("../models/User");
    let user;
    let createdNewUser = false;

    // If userId is provided, verify it exists
    if (userId) {
      user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }
    } else {
      // Create a new user for the review
      const tempEmail =
        newUserEmail ||
        `temp_${Date.now()}_${Math.random()
          .toString(36)
          .substring(7)}@sumetraders.local`;
      const tempPassword =
        Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15);

      user = await User.create({
        firstName: newUserFirstName,
        lastName: newUserLastName || "",
        email: tempEmail,
        password: tempPassword,
        role: "user",
        isEmailVerified: false,
      });

      createdNewUser = true;
    }

    // Verify product exists
    const Product = require("../models/Product");
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // If orderId provided, verify it exists
    if (orderId) {
      const order = await Order.findById(orderId);
      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      // Check if review already exists for this order
      const existingReview = await Review.findOne({
        user: user._id,
        order: orderId,
        product: productId,
      });

      if (existingReview) {
        return res.status(400).json({
          success: false,
          message:
            "Review already exists for this user/order/product combination",
        });
      }
    }

    // Create review
    const review = await Review.create({
      user: user._id,
      product: productId,
      order: orderId || null,
      rating,
      comment: comment || "",
      approvalStatus: autoApprove ? "approved" : "pending",
      isVerified: !!orderId, // Only verified if linked to an order
    });

    await review.populate("user", "firstName lastName avatar");
    await review.populate("product", "name images");
    if (orderId) {
      await review.populate("order", "orderItems");
    }

    res.status(201).json({
      success: true,
      message: `Review created successfully${autoApprove ? " and auto-approved" : ""
        }${createdNewUser ? " with new user" : ""}`,
      review,
      newUserCreated: createdNewUser,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all reviews (Admin only)
// @route   GET /api/reviews/admin/all
// @access  Private/Admin
exports.getAllReviews = async (req, res, next) => {
  try {
    const { status, limit = 50, page = 1 } = req.query;

    const query = status ? { approvalStatus: status } : {};

    const reviews = await Review.find(query)
      .populate("user", "firstName lastName email avatar")
      .populate("product", "name images")
      .populate("order", "orderId orderStatus")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Review.countDocuments(query);

    res.status(200).json({
      success: true,
      count: reviews.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      reviews,
    });
  } catch (error) {
    next(error);
  }
};
