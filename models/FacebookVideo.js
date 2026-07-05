// Removed Facebook video model

// const mongoose = require("mongoose");
// const facebookVideoSchema = new mongoose.Schema({...});
// const FacebookVideo = mongoose.model("FacebookVideo", facebookVideoSchema);
// module.exports = FacebookVideo;
const mongoose = require("mongoose");

const facebookVideoSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      default: "Video",
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"],
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    facebookVideoUrl: {
      type: String,
      trim: true,
      default: "",
    },
    thumbnailImage: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    priority: {
      type: Number,
      default: 0,
      min: 0,
    },
    ctaButtonText: {
      type: String,
      default: "Watch Video",
      trim: true,
    },
    ctaButtonLink: {
      type: String,
      trim: true,
      default: "",
    },
    autoplay: {
      type: Boolean,
      default: false,
    },
    embedLink: {
      type: String,
      trim: true,
      required: [true, "Embed link is required"],
    },
    analytics: {
      impressions: {
        type: Number,
        default: 0,
      },
      clicks: {
        type: Number,
        default: 0,
      },
      lastViewed: {
        type: Date,
        default: null,
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Index for better query performance
facebookVideoSchema.index({ isActive: 1, priority: -1, createdAt: -1 });

// Static method to get active videos
facebookVideoSchema.statics.getActiveVideos = async function () {
  return this.find({ isActive: true })
    .sort({ priority: -1, createdAt: -1 })
    .select("-__v");
};

// Instance method to track impressions
facebookVideoSchema.methods.trackImpression = async function () {
  this.analytics.impressions += 1;
  this.analytics.lastViewed = new Date();
  return this.save();
};

// Instance method to track clicks
facebookVideoSchema.methods.trackClick = async function () {
  this.analytics.clicks += 1;
  return this.save();
};

// Virtual for click-through rate
facebookVideoSchema.virtual("ctr").get(function () {
  if (this.analytics.impressions === 0) return 0;
  return ((this.analytics.clicks / this.analytics.impressions) * 100).toFixed(
    2
  );
});

const FacebookVideo = mongoose.model("FacebookVideo", facebookVideoSchema);

module.exports = FacebookVideo;
