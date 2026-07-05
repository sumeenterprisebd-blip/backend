const mongoose = require("mongoose");

const heroSchema = new mongoose.Schema(
  {
    // Only store the image for hero slider
    images: {
      type: [String],
      required: [true, "At least one image is required"],
      validate: [arr => arr.length > 0, "At least one image is required"],
    },
    // No mobile image, text, or button fields
    isActive: {
      type: Boolean,
      default: true,
    },
    priority: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Analytics
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

// Indexes for better query performance
heroSchema.index({ isActive: 1, priority: -1 });
heroSchema.index({ createdAt: -1 });

// Virtual for click-through rate
heroSchema.virtual("ctr").get(function () {
  if (this.impressions === 0) return 0;
  return ((this.clicks / this.impressions) * 100).toFixed(2);
});

// Ensure virtuals are included in JSON
heroSchema.set("toJSON", { virtuals: true });
heroSchema.set("toObject", { virtuals: true });

// Static method to get all active heroes sorted by priority
heroSchema.statics.getActiveHeroes = function () {
  return this.find({ isActive: true })
    .sort({ priority: -1, createdAt: -1 })
    .select("-__v");
};

// Method to increment impressions
heroSchema.methods.trackImpression = function () {
  this.impressions += 1;
  return this.save();
};

// Method to increment clicks
heroSchema.methods.trackClick = function () {
  this.clicks += 1;
  return this.save();
};

const Hero = mongoose.model("Hero", heroSchema);

module.exports = Hero;
