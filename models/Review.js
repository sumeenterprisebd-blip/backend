const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: false, // Allow admin to create reviews without orders
      default: null,
    },
    rating: {
      type: Number,
      required: [true, "Rating is required"],
      min: [1, "Rating must be at least 1"],
      max: [5, "Rating cannot exceed 5"],
    },
    comment: {
      type: String,
      trim: true,
      maxlength: [500, "Comment cannot exceed 500 characters"],
    },
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    isVerified: {
      type: Boolean,
      default: true, // Set to true if linked to an order
    },
  },
  {
    timestamps: true,
  }
);

// One review per user per product (with or without order)
reviewSchema.index(
  { user: 1, product: 1, order: 1 },
  { unique: true, sparse: true }
);
// Index for admin queries
reviewSchema.index({ approvalStatus: 1, createdAt: -1 });

// Update product rating when approved review is saved
reviewSchema.post("save", async function () {
  if (this.approvalStatus === "approved") {
    const Review = this.constructor;
    const stats = await Review.aggregate([
      {
        $match: {
          product: this.product,
          approvalStatus: "approved",
        },
      },
      {
        $group: {
          _id: "$product",
          avgRating: { $avg: "$rating" },
          numReviews: { $sum: 1 },
        },
      },
    ]);

    if (stats.length > 0) {
      await mongoose.model("Product").findByIdAndUpdate(this.product, {
        rating: Math.round(stats[0].avgRating * 10) / 10,
        numReviews: stats[0].numReviews,
      });
    }
  }
});

module.exports = mongoose.model("Review", reviewSchema);
