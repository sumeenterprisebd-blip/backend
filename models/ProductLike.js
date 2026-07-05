const mongoose = require("mongoose");

const productLikeSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    guestIdentifier: {
      type: String,
      default: null,
    },
    ipAddress: {
      type: String,
      required: true,
    },
    userAgent: {
      type: String,
      required: true,
    },
    likeCount: {
      type: Number,
      default: 1,
      min: 1,
    },
    lastLikedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for efficient querying
productLikeSchema.index({ product: 1, user: 1 });
productLikeSchema.index({ product: 1, guestIdentifier: 1 });
productLikeSchema.index({ product: 1, ipAddress: 1 });

// Method to check if user/guest can like
productLikeSchema.statics.canLike = async function (productId, identifier) {
  const like = await this.findOne({
    product: productId,
    $or: [{ user: identifier.userId }, { guestIdentifier: identifier.guestId }],
  });

  if (!like) return { canLike: true, currentCount: 0 };

  // Max 5 likes per user/guest per product
  const maxLikes = 5;
  return {
    canLike: like.likeCount < maxLikes,
    currentCount: like.likeCount,
    maxLikes,
  };
};

// Method to add a like
productLikeSchema.statics.addLike = async function (
  productId,
  identifier,
  ipAddress,
  userAgent
) {
  const filter = {
    product: productId,
  };

  if (identifier.userId) {
    filter.user = identifier.userId;
  } else {
    filter.guestIdentifier = identifier.guestId;
  }

  const like = await this.findOneAndUpdate(
    filter,
    {
      $inc: { likeCount: 1 },
      $set: {
        lastLikedAt: new Date(),
        ipAddress,
        userAgent,
      },
      $setOnInsert: {
        product: productId,
        user: identifier.userId || null,
        guestIdentifier: identifier.guestId || null,
      },
    },
    { upsert: true, new: true }
  );

  return like;
};

// Method to get total likes for a product
productLikeSchema.statics.getTotalLikes = async function (
  productId,
  identifier
) {
  const filter = {
    product: productId,
  };

  if (identifier.userId) {
    filter.user = identifier.userId;
  } else if (identifier.guestId) {
    filter.guestIdentifier = identifier.guestId;
  }

  const like = await this.findOne(filter);
  return like ? like.likeCount : 0;
};

module.exports = mongoose.model("ProductLike", productLikeSchema);
