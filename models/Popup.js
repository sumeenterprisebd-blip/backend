const mongoose = require("mongoose");

const popupSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Popup title is required"],
      trim: true,
    },
    message: {
      type: String,
      required: [true, "Popup message is required"],
    },
    buttonText: {
      type: String,
      default: "Got it!",
      trim: true,
    },
    buttonLink: {
      type: String,
      default: null,
    },
    imageUrl: {
      type: String,
      default: null,
    },
    backgroundColor: {
      type: String,
      default: "#ffffff",
    },
    textColor: {
      type: String,
      default: "#000000",
    },
    showOnHomepage: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    displayFrequency: {
      type: String,
      enum: ["always", "once-per-session", "once-per-day", "once-ever"],
      default: "once-per-session",
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Get active popup for homepage
popupSchema.statics.getActiveHomepagePopup = async function () {
  const now = new Date();

  const popup = await this.findOne({
    isActive: true,
    showOnHomepage: true,
    $or: [
      { startDate: null, endDate: null },
      { startDate: { $lte: now }, endDate: null },
      { startDate: null, endDate: { $gte: now } },
      { startDate: { $lte: now }, endDate: { $gte: now } },
    ],
  }).sort({ createdAt: -1 });

  return popup;
};

module.exports = mongoose.model("Popup", popupSchema);
