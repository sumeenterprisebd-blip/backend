const Settings = require("../models/Settings");
const { cloudinary } = require("../utils/cloudinary");
const { clearCache } = require("../middleware/cache");

const extractGtmId = (input) => {
  const text = String(input || "").trim();
  if (!text) return "";
  const match = text.toUpperCase().match(/GTM-[A-Z0-9]+/);
  return match ? match[0] : "";
};

const extractFacebookPixelId = (input) => {
  const text = String(input || "").trim();
  if (!text) return "";
  // Common cases:
  // - "1234567890"
  // - fbq('init', '1234567890')
  // - fbq("init","1234567890")
  const initMatch = text.match(/fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{5,20})['"]\s*\)/i);
  if (initMatch) return initMatch[1];

  const digitsMatch = text.match(/\b(\d{5,20})\b/);
  return digitsMatch ? digitsMatch[1] : "";
};

const extractGaMeasurementId = (input) => {
  const text = String(input || "").trim();
  if (!text) return "";
  // GA4 measurement id: G-XXXXXXXXXX (letters+digits)
  const match = text.toUpperCase().match(/\bG-[A-Z0-9]{6,20}\b/);
  return match ? match[0] : "";
};

const extractClarityProjectId = (input) => {
  const text = String(input || "").trim();
  if (!text) return "";

  // Common snippet contains: https://www.clarity.ms/tag/<PROJECT_ID>
  const urlMatch = text.match(/clarity\.ms\/tag\/(\w{5,40})/i);
  if (urlMatch) return urlMatch[1];

  // Accept plain project id (alphanumeric)
  const idMatch = text.match(/\b(\w{5,40})\b/);
  return idMatch ? idMatch[1] : "";
};

const toBool = (value, fallback) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return fallback;
};

const toIntClamped = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  const clampedMin = Number.isFinite(min) ? min : parsed;
  const clampedMax = Number.isFinite(max) ? max : parsed;
  return Math.min(clampedMax, Math.max(clampedMin, parsed));
};

const sanitizeOrderSecurity = (incoming, existing = {}) => {
  const src = incoming && typeof incoming === "object" ? incoming : {};

  const requireOtpBeforeOrders = toBool(
    src.requireOtpBeforeOrders,
    !!existing.requireOtpBeforeOrders
  );

  const rawMethod = String(src.otpMethod ?? existing.otpMethod ?? "none").toLowerCase();
  const otpMethod = requireOtpBeforeOrders
    ? (rawMethod === "email" ? "email" : "email")
    : "none";

  return {
    enableRiskApproval: toBool(src.enableRiskApproval, !!existing.enableRiskApproval),
    riskApprovalThreshold: toIntClamped(
      src.riskApprovalThreshold,
      Number.isFinite(existing.riskApprovalThreshold) ? existing.riskApprovalThreshold : 50,
      0,
      200
    ),

    requireVerifiedForOrders: toBool(
      src.requireVerifiedForOrders,
      !!existing.requireVerifiedForOrders
    ),
    requireOtpBeforeOrders,
    otpMethod,

    blockSuspiciousUsers: toBool(src.blockSuspiciousUsers, !!existing.blockSuspiciousUsers),
    requireShippingPhoneMatchesAccount: toBool(
      src.requireShippingPhoneMatchesAccount,
      !!existing.requireShippingPhoneMatchesAccount
    ),

    phoneMinDigits: toIntClamped(
      src.phoneMinDigits,
      Number.isFinite(existing.phoneMinDigits) ? existing.phoneMinDigits : 10,
      6,
      20
    ),
    phoneMaxDigits: toIntClamped(
      src.phoneMaxDigits,
      Number.isFinite(existing.phoneMaxDigits) ? existing.phoneMaxDigits : 15,
      6,
      20
    ),

    duplicateOrderWindowHours: toIntClamped(
      src.duplicateOrderWindowHours,
      Number.isFinite(existing.duplicateOrderWindowHours)
        ? existing.duplicateOrderWindowHours
        : 6,
      1,
      168
    ),

    sharedIpWindowHours: toIntClamped(
      src.sharedIpWindowHours,
      Number.isFinite(existing.sharedIpWindowHours) ? existing.sharedIpWindowHours : 24,
      1,
      168
    ),
    sharedIpMaxUsers: toIntClamped(
      src.sharedIpMaxUsers,
      Number.isFinite(existing.sharedIpMaxUsers) ? existing.sharedIpMaxUsers : 3,
      2,
      50
    ),

    rateWindowMinutes: toIntClamped(
      src.rateWindowMinutes,
      Number.isFinite(existing.rateWindowMinutes) ? existing.rateWindowMinutes : 10,
      1,
      120
    ),
    rateMaxInWindow: toIntClamped(
      src.rateMaxInWindow,
      Number.isFinite(existing.rateMaxInWindow) ? existing.rateMaxInWindow : 3,
      1,
      50
    ),
    rateDayHours: toIntClamped(
      src.rateDayHours,
      Number.isFinite(existing.rateDayHours) ? existing.rateDayHours : 24,
      1,
      168
    ),
    rateMaxPerDay: toIntClamped(
      src.rateMaxPerDay,
      Number.isFinite(existing.rateMaxPerDay) ? existing.rateMaxPerDay : 20,
      1,
      200
    ),
  };
};

// @desc    Get global settings
// @route   GET /api/settings
// @access  Public
exports.getSettings = async (req, res, next) => {
  try {
    const settings = await Settings.getSettings();

    // Include public payment availability flags (no secrets).
    let paymentFlags = { sslcommerz: { enabled: false } };
    try {
      const PaymentSettings = require("../models/PaymentSettings");
      const ps = await PaymentSettings.getSettings();
      paymentFlags = {
        sslcommerz: {
          enabled: Boolean(ps?.sslcommerz?.enabled),
        },
      };
    } catch {
      // Best-effort only; do not block public settings.
    }

    // Cache settings for storefront visitors, but never cache for authenticated/admin requests.
    // This prevents stale tracking codes showing up across devices after an admin saves.
    if (req.headers.authorization) {
      res.set("Cache-Control", "no-store");
    } else {
      // Set aggressive cache headers for public settings reads (rarely change)
      res.set("Cache-Control", "public, max-age=600, stale-while-revalidate=1800");
    }

    const settingsObj = settings?.toObject ? settings.toObject() : settings;

    res.status(200).json({
      success: true,
      settings: {
        ...(settingsObj || {}),
        payments: paymentFlags,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update settings
// @route   PUT /api/settings
// @access  Private/Admin
exports.updateSettings = async (req, res, next) => {
  try {
    const updates = { ...(req.body || {}) };

    if (Object.prototype.hasOwnProperty.call(updates, "gtmId")) {
      const extracted = extractGtmId(updates.gtmId);
      const rawProvided = String(updates.gtmId || "").trim();
      if (rawProvided && !extracted) {
        return res.status(400).json({
          success: false,
          message: "Invalid GTM ID. Use format GTM-XXXXXXX or paste the GTM snippet.",
        });
      }
      updates.gtmId = extracted;
    }

    if (Object.prototype.hasOwnProperty.call(updates, "facebookPixelId")) {
      const extracted = extractFacebookPixelId(updates.facebookPixelId);
      const rawProvided = String(updates.facebookPixelId || "").trim();
      if (rawProvided && !extracted) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid Facebook Pixel ID. Paste the Pixel ID or the full Pixel snippet.",
        });
      }
      updates.facebookPixelId = extracted;
    }

    if (Object.prototype.hasOwnProperty.call(updates, "googleAnalyticsMeasurementId")) {
      const extracted = extractGaMeasurementId(updates.googleAnalyticsMeasurementId);
      const rawProvided = String(updates.googleAnalyticsMeasurementId || "").trim();
      if (rawProvided && !extracted) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid Google Analytics Measurement ID. Use format G-XXXXXXXXXX or paste the GA snippet.",
        });
      }
      updates.googleAnalyticsMeasurementId = extracted;
    }

    if (Object.prototype.hasOwnProperty.call(updates, "microsoftClarityProjectId")) {
      const extracted = extractClarityProjectId(updates.microsoftClarityProjectId);
      const rawProvided = String(updates.microsoftClarityProjectId || "").trim();
      if (rawProvided && !extracted) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid Microsoft Clarity Project ID. Paste the Project ID or the full Clarity snippet.",
        });
      }
      updates.microsoftClarityProjectId = extracted;
    }

    if (Object.prototype.hasOwnProperty.call(updates, "orderSecurity")) {
      const current = await Settings.getSettings();
      updates.orderSecurity = sanitizeOrderSecurity(
        updates.orderSecurity,
        current?.orderSecurity || {}
      );
    }

    const settings = await Settings.updateSettings(updates);

    // Invalidate cached settings responses (in-memory cache middleware)
    clearCache("/api/settings");

    res.status(200).json({
      success: true,
      message: "Settings updated successfully",
      settings,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Upload logo
// @route   POST /api/settings/logo
// @access  Private/Admin
exports.uploadLogo = async (req, res, next) => {
  try {
    const { imageData } = req.body;

    // Validate image data
    if (!imageData) {
      return res.status(400).json({
        success: false,
        message: "Image data is required",
      });
    }

    // Validate base64 format
    if (!imageData.startsWith("data:image/")) {
      return res.status(400).json({
        success: false,
        message: "Invalid image format. Please upload a valid image file.",
      });
    }

    // Validate image type
    const supportedFormats = ["png", "jpg", "jpeg", "webp", "svg", "gif"];
    const imageType = imageData.match(/^data:image\/(\w+);base64,/);
    if (!imageType || !supportedFormats.includes(imageType[1].toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: `Unsupported image format. Supported formats: ${supportedFormats.join(
          ", "
        )}`,
      });
    }

    let logoUrl;
    const hasCloudinaryConfig =
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET;

    // Try Cloudinary first if configured
    if (hasCloudinaryConfig) {
      try {
        const result = await cloudinary.uploader.upload(imageData, {
          folder: "logos",
          resource_type: "image",
          allowed_formats: ["png", "jpg", "jpeg", "webp", "svg"],
          transformation: [
            { width: 500, height: 500, crop: "limit", quality: "auto" },
          ],
        });

        if (result && result.secure_url) {
          logoUrl = result.secure_url;
        }
      } catch (cloudinaryError) {
        // Don't return error, fall through to local storage
      }
    }

    // Fallback to local storage if Cloudinary not configured or failed
    if (!logoUrl) {
      const fs = require("fs");
      const path = require("path");

      try {
        // Extract base64 data and file extension
        const matches = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
        if (!matches) {
          throw new Error("Invalid base64 image format");
        }

        const extension = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, "base64");

        // Create uploads directory if it doesn't exist
        const uploadsDir = path.join(
          __dirname,
          "..",
          "public",
          "uploads",
          "logos"
        );
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }

        // Generate unique filename
        const filename = `logo-${Date.now()}.${extension}`;
        const filePath = path.join(uploadsDir, filename);

        // Save file
        fs.writeFileSync(filePath, buffer);

        // Return full URL path (with backend server URL)
        const backendUrl =
          process.env.BACKEND_URL ||
          `http://localhost:${process.env.PORT || 5000}`;
        logoUrl = `${backendUrl}/uploads/logos/${filename}`;
      } catch (localError) {
        return res.status(500).json({
          success: false,
          message:
            "Failed to save image. Please try again or contact administrator.",
        });
      }
    }

    // Validate upload result
    if (!logoUrl) {
      return res.status(500).json({
        success: false,
        message: "Failed to upload logo. Please try again.",
      });
    }

    // Update settings with the new logo URL
    const settings = await Settings.updateSettings({ logo: logoUrl });

    // Invalidate cached settings responses (in-memory cache middleware)
    clearCache("/api/settings");

    res.status(200).json({
      success: true,
      message: "Logo uploaded successfully",
      settings,
      logoUrl: logoUrl,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Failed to upload logo. Please try again.",
    });
  }
};
