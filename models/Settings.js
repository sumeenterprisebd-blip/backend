const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    // Google Tag Manager
    gtmId: {
      type: String,
      default: "",
    },

    // Tracking / Analytics (admin-managed)
    facebookPixelId: {
      type: String,
      default: "",
    },
    googleAnalyticsMeasurementId: {
      type: String,
      default: "",
    },
    microsoftClarityProjectId: {
      type: String,
      default: "",
    },
    // Site Identity
    siteName: {
      type: String,
      default: "Sume Traders",
    },
    logo: {
      type: String,
      default: "/logo.jpeg",
    },
    favicon: {
      type: String,
      default: "/favicon.ico",
    },
    tagline: {
      type: String,
      default: "Your Premium Fashion Destination",
    },

    // Contact Information
    email: {
      type: String,
      default: "support@sumetraders.com",
    },
    phone: {
      type: String,
      default: "+1 (234) 567-890",
    },
    address: {
      type: String,
      default: "",
    },

    // Social Media Links
    socialMedia: {
      facebook: { type: String, default: "" },
      instagram: { type: String, default: "" },
      twitter: { type: String, default: "" },
      youtube: { type: String, default: "" },
      linkedin: { type: String, default: "" },
    },

    // Business Settings
    currency: {
      type: String,
      default: "BDT",
    },
    currencySymbol: {
      type: String,
      default: "৳",
    },
    timezone: {
      type: String,
      default: "Asia/Dhaka",
    },

    // Shipping Settings
    defaultDeliveryFee: {
      type: Number,
      default: 15,
    },
    freeShippingThreshold: {
      type: Number,
      default: 999,
    },

    // Combo Offer Settings
    comboOfferEnabled: {
      type: Boolean,
      default: true,
    },
    comboOfferMinQuantity: {
      type: Number,
      default: 2,
      min: 1,
    },
    comboOfferMinLikes: {
      type: Number,
      default: 2,
      min: 1,
      max: 5,
    },
    comboOfferApplyToAll: {
      type: Boolean,
      default: true,
    },
    comboOfferProductIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],

    // Discount Settings
    defaultDiscountPercent: {
      type: Number,
      default: 20,
    },

    // Footer Content
    footerAbout: {
      type: String,
      default:
        "Discover the latest trends in fashion with Sume Traders. Quality clothing for every style.",
    },
    copyrightText: {
      type: String,
      default: "© 2024 Sume Traders. All rights reserved.",
    },

    // Maintenance
    maintenanceMode: {
      type: Boolean,
      default: false,
    },
    maintenanceMessage: {
      type: String,
      default: "We are currently updating our website. Please check back soon!",
    },

    // Order Security / Anti-fake-order controls (admin-managed)
    orderSecurity: {
      enableRiskApproval: { type: Boolean, default: true },
      riskApprovalThreshold: { type: Number, default: 50, min: 0, max: 200 },

      // Stronger verification controls
      requireVerifiedForOrders: { type: Boolean, default: false },
      requireOtpBeforeOrders: { type: Boolean, default: false },
      otpMethod: {
        type: String,
        enum: ["none", "email"],
        default: "none",
      },

      // Blocking rules
      blockSuspiciousUsers: { type: Boolean, default: false },
      requireShippingPhoneMatchesAccount: { type: Boolean, default: false },

      // Phone validation
      phoneMinDigits: { type: Number, default: 10, min: 6, max: 20 },
      phoneMaxDigits: { type: Number, default: 15, min: 6, max: 20 },

      // Duplicate order monitoring
      duplicateOrderWindowHours: { type: Number, default: 6, min: 1, max: 168 },

      // Shared IP monitoring
      sharedIpWindowHours: { type: Number, default: 24, min: 1, max: 168 },
      sharedIpMaxUsers: { type: Number, default: 3, min: 2, max: 50 },

      // Order frequency monitoring
      rateWindowMinutes: { type: Number, default: 10, min: 1, max: 120 },
      rateMaxInWindow: { type: Number, default: 3, min: 1, max: 50 },
      rateDayHours: { type: Number, default: 24, min: 1, max: 168 },
      rateMaxPerDay: { type: Number, default: 20, min: 1, max: 200 },
    },

    // Web Push subscriptions for admin notifications
    adminPushSubscriptions: {
      type: [
        {
          endpoint: { type: String, required: true },
          expirationTime: { type: Number, default: null },
          keys: {
            p256dh: { type: String, required: true },
            auth: { type: String, required: true },
          },
          userAgent: { type: String, default: "" },
          createdAt: { type: Date, default: Date.now },
          lastUsedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Ensure only one settings document exists
settingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

settingsSchema.statics.updateSettings = async function (updates) {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create(updates);
  } else {
    Object.assign(settings, updates);
    await settings.save();
  }
  return settings;
};

module.exports = mongoose.model("Settings", settingsSchema);
