const mongoose = require("mongoose");

const campaignSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Campaign title is required"],
      trim: true,
    },
    subtitle: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    discountText: {
      type: String,
      default: "Up to 50% Off",
      trim: true,
    },
    bannerImage: {
      type: String,
      required: [true, "Banner image is required"],
    },
    mobileBannerImage: {
      type: String,
    },
    ctaButtonText: {
      type: String,
      default: "Shop Now",
      trim: true,
    },
    ctaButtonLink: {
      type: String,
      default: "/shop",
      trim: true,
    },
    startDate: {
      type: Date,
      required: [true, "Start date is required"],
    },
    endDate: {
      type: Date,
      required: [true, "End date is required"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    backgroundColor: {
      type: String,
      default: "gradient-to-r from-pink-500 to-red-500",
    },
    textColor: {
      type: String,
      default: "text-black",
    },
    priority: {
      type: Number,
      default: 0,
    },
    impressions: {
      type: Number,
      default: 0,
    },
    clicks: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Index for active campaigns
campaignSchema.index({ isActive: 1, startDate: 1, endDate: 1 });

// Virtual for checking if campaign is currently active
campaignSchema.virtual("isCurrentlyActive").get(function () {
  const now = new Date();
  return this.isActive && this.startDate <= now && this.endDate >= now;
});

// Method to check if campaign is valid for current date
campaignSchema.methods.isValidForDate = function (date = new Date()) {
  return this.isActive && this.startDate <= date && this.endDate >= date;
};

// Static method to get active campaign
campaignSchema.statics.getActiveCampaign = async function () {
  const now = new Date();
  return this.findOne({
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
  }).sort({ priority: -1, createdAt: -1 });
};

module.exports = mongoose.model("Campaign", campaignSchema);
