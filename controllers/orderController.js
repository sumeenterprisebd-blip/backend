const Order = require("../models/Order");
const Cart = require("../models/Cart");
const Product = require("../models/Product");
const User = require("../models/User");
const AdvancePayment = require("../models/AdvancePayment");
const Blacklist = require("../models/Blacklist");
const googleSheetsService = require("../utils/googleSheets");
const Counter = require("../models/Counter");
const PaymentSettings = require("../models/PaymentSettings");
const { getSettingsCached } = require("../services/settingsCache");
const { buildTrackingData } = require("../services/orderHelpers");
const pathaoService = require("../utils/pathao");
const webPushService = require("../services/webPush");
const Notification = require("../models/Notification");
const axios = require("axios");
const crypto = require("crypto");
const { initiatePayment } = require("../services/sslcommerzService");
const { sendMetaCapiPurchase } = require("../services/metaCapiService");
const FREE_DELIVERY_MIN_PIECES = 3;
// Meta CAPI is provided by shared service `services/metaCapiService.js` to
// allow server-side events to be triggered from multiple controllers (orders,
// payment callbacks) while keeping a single implementation.
const isLikelyFakeName = ({ firstName, lastName }) => {
  const first = String(firstName || "").trim();
  const last = String(lastName || "").trim();
  const full = `${first} ${last}`.trim().toLowerCase();

  if (!full) return true;

  const whitelistShort = new Set(["md", "mr", "ms", "mrs"]);
  if (first && first.length <= 2 && whitelistShort.has(first.toLowerCase())) return false;

  const blacklist = [
    "test",
    "abcd",
    "abc",
    "asdf",
    "qwerty",
    "demo",
    "unknown",
    "no name",
    "name",
    "na",
  ];

  if (blacklist.includes(full) || blacklist.includes(first.toLowerCase())) return true;
  if (/\d/.test(full)) return true;
  if (!/\p{L}/u.test(full)) return true;
  if (first.length < 2) return true;
  if (/^(.)\1{3,}$/u.test(first.toLowerCase())) return true;
  if (last && /^(.)\1{3,}$/u.test(last.toLowerCase())) return true;

  return false;
};
const computeOrderRiskLevel = ({
  order,
  customerStats,
}) => {
  const flags = new Set(Array.isArray(order?.riskFlags) ? order.riskFlags : []);
  const isSuspicious = Boolean(order?.isSuspicious) || flags.has("repeat_phone") || flags.has("repeat_ip") || flags.has("fake_name");

  const delivered = Number(customerStats?.delivered || 0);
  const cancelled = Number(customerStats?.cancelled || 0);
  const total = Number(customerStats?.total || 0);

  // Safe: proven customer with successful history and no active suspicious flags.
  if (!isSuspicious && delivered >= 2 && cancelled === 0) return "safe";

  // High: suspicious flags or poor history.
  if (isSuspicious) return "high";
  if (cancelled >= 2) return "high";
  if (total >= 3 && delivered === 0) return "high";

  return "medium";
};

const parseCookies = (cookieHeader) => {
  const header = String(cookieHeader || "");
  const out = {};
  if (!header) return out;
  header.split(";").forEach((part) => {
    const [rawKey, ...rest] = part.split("=");
    const key = String(rawKey || "").trim();
    if (!key) return;
    const value = rest.join("=").trim();
    out[key] = decodeURIComponent(value);
  });
  return out;
};

const sha256Hex = (value) => {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "";
  return crypto.createHash("sha256").update(v).digest("hex");
};

const normalizeBdPhoneForMeta = (value) => {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return "";

  // Accept canonical formats and coerce to E.164 digits (no '+'): 8801XXXXXXXXX
  if (digits.startsWith("8801") && digits.length === 13) return digits;
  if (digits.startsWith("01") && digits.length === 11) return `880${digits.slice(1)}`;
  if (digits.startsWith("1") && digits.length === 10) return `880${digits}`;
  return digits;
};

// Use `services/metaCapiService.js` (imported above) for server-side purchase events.

const normalizeText = (value) => String(value || "").trim().toLowerCase();
const normalizePhone = (value) => {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return "";

  // Bangladesh canonicalization: +8801XXXXXXXXX / 8801XXXXXXXXX -> 01XXXXXXXXX
  if (digits.startsWith("8801") && digits.length === 13) {
    return `0${digits.slice(3)}`;
  }

  return digits;
};

const normalizeAddressKey = (address = {}) => {
  if (!address || typeof address !== "object") return "";
  const parts = [
    address.streetAddress,
    address.area,
    address.townCity,
    address.state,
    address.zipCode,
    address.country,
  ]
    .filter((part) => part !== undefined && part !== null && String(part).trim() !== "")
    .map((part) =>
      String(part)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^a-z0-9\s]/g, "")
    );
  return parts.join("|");
};

const isValidBdPhone = (value) => /^01[3-9]\d{8}$/.test(normalizePhone(value));

const normalizePaymentMethod = (value) => {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "";

  // Common synonyms -> canonical values used across the codebase
  if (["cash on delivery", "cash_on_delivery", "cod", "cashondelivery"].includes(v)) return "cash";
  if (["ssl", "ssl_commerz", "sslcommerz"].includes(v)) return "sslcommerz";
  if (["bkash", "nagad", "rocket", "upay", "mobilebanking", "mobile_banking", "advance_payment", "full_payment"].includes(v)) return "advance";

  return v;
};

const computeUnitOriginal = (unitEffective, rawOriginal, rawDiscountPercent) => {
  const effective = Number(unitEffective) || 0;
  const original = Number(rawOriginal) || 0;
  const discountPercent = Number(rawDiscountPercent) || 0;

  const derivedOriginal = discountPercent > 0 && effective > 0
    ? effective / (1 - discountPercent / 100)
    : effective;

  return Math.max(original, derivedOriginal, effective);
};

const normalizePricingTiers = (tiers = []) => {
  if (!Array.isArray(tiers)) return [];

  return tiers
    .map((tier) => ({
      minQty: Number(tier?.minQty),
      maxQty: tier?.maxQty === "" || tier?.maxQty === null || tier?.maxQty === undefined ? null : Number(tier.maxQty),
      price: Number(tier?.price),
    }))
    .filter((tier) => Number.isFinite(tier.minQty) && tier.minQty > 0 && Number.isFinite(tier.price) && tier.price >= 0)
    .sort((a, b) => a.minQty - b.minQty);
};

const getEffectiveUnitPrice = (product, quantity = 1) => {
  const basePrice = Number(product?.price || 0);
  const safeQuantity = Math.max(1, Number(quantity) || 1);
  const tiers = normalizePricingTiers(product?.pricingTiers);

  let effectiveUnitPrice = basePrice;
  for (const tier of tiers) {
    const meetsMin = safeQuantity >= tier.minQty;
    const meetsMax = tier.maxQty === null || safeQuantity <= tier.maxQty;
    if (meetsMin && meetsMax) {
      effectiveUnitPrice = tier.price;
      break;
    }
  }

  return effectiveUnitPrice;
};

const computeOrderPricingFromProducts = (productsWithQty) => {
  const list = Array.isArray(productsWithQty) ? productsWithQty : [];

  let originalSubtotal = 0;
  let effectiveSubtotal = 0;
  let discountAmount = 0;

  for (const entry of list) {
    const product = entry?.product;
    const qty = Number(entry?.quantity || 0);
    if (!product || !Number.isFinite(qty) || qty <= 0) continue;

    const unitEffective = Number(product.price || 0);
    const unitOriginal = computeUnitOriginal(
      unitEffective,
      product.originalPrice,
      product.discount
    );

    originalSubtotal += unitOriginal * qty;
    effectiveSubtotal += unitEffective * qty;
    discountAmount += Math.max(unitOriginal - unitEffective, 0) * qty;
  }

  if (!Number.isFinite(originalSubtotal)) originalSubtotal = 0;
  if (!Number.isFinite(effectiveSubtotal)) effectiveSubtotal = 0;
  if (!Number.isFinite(discountAmount)) discountAmount = 0;

  return {
    originalSubtotal,
    effectiveSubtotal,
    discountAmount,
  };
};

const computeCartPricingFromItems = (items) => {
  let originalSubtotal = 0;
  let effectiveSubtotal = 0;
  let discountAmount = 0;

  for (const item of items) {
    const qty = Number(item?.quantity || 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const unitEffective = Number(item?.price || 0);
    const rawOriginal = Number(item?.product?.originalPrice || 0);
    const rawDiscountPercent = Number(item?.product?.discount || 0);
    const unitOriginal = computeUnitOriginal(unitEffective, rawOriginal, rawDiscountPercent);

    originalSubtotal += unitOriginal * qty;
    effectiveSubtotal += unitEffective * qty;
    discountAmount += Math.max(unitOriginal - unitEffective, 0) * qty;
  }

  if (!Number.isFinite(originalSubtotal)) originalSubtotal = 0;
  if (!Number.isFinite(effectiveSubtotal)) effectiveSubtotal = 0;
  if (!Number.isFinite(discountAmount)) discountAmount = 0;

  return {
    originalSubtotal,
    effectiveSubtotal,
    discountAmount,
  };
};

const parseBool = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(v)) return true;
  if (["false", "0", "no", "n", "off"].includes(v)) return false;
  return undefined;
};

const getMinQty = (product) => {
  const raw = product?.freeDeliveryMinQty;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 2;
};

const computeComboFreeDeliveryEligibility = (items) => {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return { eligible: false, reason: "no_items" };

  const categoryKeys = new Set(
    list
      .map((i) => normalizeText(i?.product?.category))
      .filter(Boolean)
  );
  if (categoryKeys.size !== 1) return { eligible: false, reason: "multi_category" };

  const allEligible = list.every((i) => {
    const p = i?.product;
    return !!p && !!p.isComboOffer && !!p.freeDelivery;
  });
  if (!allEligible) return { eligible: false, reason: "not_all_eligible" };

  const minQtySet = new Set(list.map((i) => getMinQty(i?.product)));
  if (minQtySet.size !== 1) return { eligible: false, reason: "criteria_mismatch" };

  const requiredQty = [...minQtySet][0];
  const totalQty = list.reduce((sum, i) => sum + Number(i?.quantity || 0), 0);
  if (totalQty < requiredQty) return { eligible: false, reason: "qty_not_met", requiredQty, totalQty };

  return { eligible: true, reason: "eligible", requiredQty, totalQty };
};

const ensureOrderNumber = async (order) => {
  if (!order || order.orderNumber) return order;
  const nextNumber = await Counter.getNextSequence("orderNumber");
  order.orderNumber = nextNumber;
  await order.save();
  return order;
};

const parseIntEnv = (name, fallback) => {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || "";
};

const buildOrderFingerprint = (items) => {
  const list = Array.isArray(items) ? items : [];
  const parts = list
    .map((item) => {
      const productId = String(item?.product || item?.productId || "");
      const qty = Number(item?.quantity || 0);
      return productId && qty ? `${productId}:${qty}` : "";
    })
    .filter(Boolean)
    .sort();
  return parts.join("|");
};

const computeRiskScore = (flags) => {
  const list = Array.isArray(flags) ? flags : [];
  const weights = {
    duplicate_phone: 30,
    phone_mismatch: 20,
    duplicate_order: 40,
    unverified_account: 15,
    shared_ip: 25,
    suspicious_user: 30,
    repeat_phone: 20,
    repeat_ip: 15,
    fake_name: 20,
  };

  return list.reduce((sum, flag) => sum + (weights[flag] || 10), 0);
};

const markUserSuspicious = async (userId, { reason, tags }) => {
  if (!userId) return;
  const tagList = Array.isArray(tags) ? tags.filter(Boolean) : [];

  try {
    await User.updateOne(
      { _id: userId },
      {
        $set: {
          isSuspicious: true,
          suspiciousMarkedAt: new Date(),
          ...(reason ? { suspiciousReason: reason } : {}),
        },
        ...(tagList.length ? { $addToSet: { suspiciousTags: { $each: tagList } } } : {}),
      }
    );
  } catch {
    // Best-effort only
  }
};

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
exports.createOrder = async (req, res, next) => {
  try {
    console.log('[ORDER_CREATE_START]', {
      timestamp: new Date().toISOString(),
      isAuthenticated: Boolean(req.user),
      userId: req.user?._id,
      itemCount: req.body?.orderItems?.length || 0,
    });

    const {
      orderItems,
      shippingAddress: shippingAddressInput,
      paymentMethod,
      discountPercent = 0,
      deliveryFee = 15,
      metaEventId,
      advancePayment = {},
      advancePaid = 0,
    } = req.body;

    const normalizedPaymentMethod = normalizePaymentMethod(paymentMethod);
    const advancePaymentMethod = String(advancePayment.paymentMethod || '').trim().toLowerCase();
    const advanceSenderNumber = normalizePhone(String(advancePayment.senderNumber || '').trim());
    const advancePaymentTransactionId = String(advancePayment.transactionId || '').trim();
    const advancePaymentLast4 = String(advancePayment.last4 || advancePaymentTransactionId.slice(-4) || '').trim();
    const advancePaidAmount = Number(advancePayment.amount || advancePaid || 0);

    const settings = await getSettingsCached().catch(() => null);
    const orderSecurity = settings?.orderSecurity || {};

    const rawFreeShippingThreshold = Number(settings?.freeShippingThreshold || 0);
    const freeShippingThreshold = Number.isFinite(rawFreeShippingThreshold)
      ? Math.max(999, rawFreeShippingThreshold)
      : 999;

    const shippingAddress = {
      ...(shippingAddressInput || {}),
      firstName: String(shippingAddressInput?.firstName || "").trim(),
      lastName: String(shippingAddressInput?.lastName || "").trim(),
      phone: normalizePhone(shippingAddressInput?.phone),
      streetAddress: String(shippingAddressInput?.streetAddress || "").trim(),
      townCity: String(shippingAddressInput?.townCity || "").trim(),
      area: String(shippingAddressInput?.area || "").trim(),
    };

    const phoneDigits = shippingAddress.phone;
    if (!isValidBdPhone(phoneDigits)) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number",
      });
    }

    const paymentSettings = await PaymentSettings.getSettings().catch(() => null);
    const advanceMethods = Array.isArray(paymentSettings?.advancePayment?.supportedMethods)
      ? paymentSettings.advancePayment.supportedMethods.map((item) => String(item || "").toLowerCase())
      : ["bkash", "nagad", "rocket", "upay"];

    if (normalizedPaymentMethod === 'advance') {
      if (!advancePaymentMethod || !advanceMethods.includes(advancePaymentMethod)) {
        return res.status(400).json({
          success: false,
          message: "Invalid advance payment method",
        });
      }

      if (!isValidBdPhone(advanceSenderNumber)) {
        return res.status(400).json({
          success: false,
          message: "Invalid advance sender mobile number",
        });
      }

      if (!Number.isFinite(advancePaidAmount) || advancePaidAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Advance paid amount must be greater than zero",
        });
      }
    }

    const cancelledOrderCount = await Order.countDocuments({
      $or: [
        ...(req.user ? [{ user: req.user._id }] : []),
        { "shippingAddress.phone": phoneDigits },
        { "guestInfo.phone": phoneDigits },
      ],
      orderStatus: "cancelled",
    });

    const hasCancelledOrderHistory = cancelledOrderCount > 0;
    const pendingAdvancePayment = hasCancelledOrderHistory
      ? await AdvancePayment.findOne({ customerPhone: phoneDigits, status: "Pending" }).sort({ createdAt: -1 })
      : null;
    const approvedAdvancePayment = hasCancelledOrderHistory
      ? await AdvancePayment.findOne({ customerPhone: phoneDigits, status: "Approved", usedAt: null }).sort({ approvedAt: 1 })
      : null;

    let isAdvanceRequired = false;
    const hasAdvanceApproval = Boolean(approvedAdvancePayment) || Boolean(req.user?.advanceVerified);
    if (hasCancelledOrderHistory && !hasAdvanceApproval) {
      if (pendingAdvancePayment) {
        return res.status(403).json({
          success: false,
          message: "An advance payment request is already pending approval. Please wait until it is verified.",
          needsAdvance: true,
        });
      }
      isAdvanceRequired = true;
    }

    const phoneMinDigits = Math.max(6, Number(orderSecurity.phoneMinDigits || 10));
    const phoneMaxDigits = Math.max(phoneMinDigits, Number(orderSecurity.phoneMaxDigits || 15));
    if (phoneDigits && (phoneDigits.length < phoneMinDigits || phoneDigits.length > phoneMaxDigits)) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number",
      });
    }

    // If authenticated, apply account-level restrictions.
    if (req.user) {
      if (req.user.status === "blocked" || req.user.status === "suspended" || req.user.isBlocked) {
        return res.status(403).json({
          success: false,
          message: "Your account is not allowed to place orders",
        });
      }

      if (orderSecurity.blockSuspiciousUsers && req.user.isSuspicious) {
        return res.status(403).json({
          success: false,
          message: "Your account requires review before placing orders",
        });
      }
    }

    const requireVerifiedSetting = Boolean(orderSecurity.requireVerifiedForOrders);
    const requireVerifiedEnv = String(process.env.REQUIRE_VERIFIED_FOR_ORDERS || "").toLowerCase() === "true";
    const requireVerified = requireVerifiedSetting || requireVerifiedEnv;

    if (req.user) {
      const otpMethod = String(orderSecurity.otpMethod || "none").toLowerCase();
      const requireOtpBeforeOrders = Boolean(orderSecurity.requireOtpBeforeOrders) && otpMethod !== "none";

      if (requireOtpBeforeOrders) {
        if (otpMethod === "email") {
          if (!req.user.isEmailVerified) {
            return res.status(403).json({
              success: false,
              message: "OTP verification required to place orders",
            });
          }
        } else {
          return res.status(403).json({
            success: false,
            message: "OTP verification is enabled but not configured",
          });
        }
      }

      if (requireVerified) {
        const hasEmail = Boolean(req.user.email);
        const hasPhone = Boolean(req.user.phone);
        const emailOk = !hasEmail || Boolean(req.user.isEmailVerified);
        const phoneOk = !hasPhone || Boolean(req.user.isPhoneVerified);

        if (!emailOk || !phoneOk) {
          return res.status(403).json({
            success: false,
            message: "Account verification required to place orders",
          });
        }
      }
    }

    const cookieMap = parseCookies(req?.headers?.cookie);
    const clientMeta = {
      ipAddress: getClientIp(req),
      userAgent: req.get("user-agent") || "",
      metaEventId: String(metaEventId || "").trim(),
      // Prefer cookies from request headers, but fall back to explicit values in the request body
      fbp: String(cookieMap._fbp || req.body?.fbp || "").trim(),
      fbc: String(cookieMap._fbc || req.body?.fbc || "").trim(),
    };

    // Blacklist enforcement (phone / IP / delivery address)
    const addressKey = normalizeAddressKey(shippingAddress);
    const checks = [];
    checks.push(Blacklist.findOne({ type: "phone", normalized: phoneDigits, active: true }).lean());
    if (clientMeta.ipAddress) {
      checks.push(Blacklist.findOne({ type: "ip", normalized: clientMeta.ipAddress, active: true }).lean());
    } else {
      checks.push(Promise.resolve(null));
    }
    if (addressKey) {
      checks.push(Blacklist.findOne({ type: "address", normalized: addressKey, active: true }).lean());
    } else {
      checks.push(Promise.resolve(null));
    }

    const [blockedPhone, blockedIp, blockedAddress] = await Promise.all(checks);
    if (blockedPhone || blockedIp || blockedAddress) {
      return res.status(403).json({
        success: false,
        message: "Your order cannot be processed. Please contact support.",
      });
    }

    const riskFlags = [];

    // Fake/unrealistic names
    if (isLikelyFakeName({ firstName: shippingAddress.firstName, lastName: shippingAddress.lastName })) {
      riskFlags.push("fake_name");
    }

    if (req.user?.isSuspicious) {
      riskFlags.push("suspicious_user");
    }

    // Unverified account signal (does not block unless REQUIRE_VERIFIED_FOR_ORDERS is enabled).
    try {
      const hasEmail = Boolean(req.user.email);
      const hasPhone = Boolean(req.user.phone);
      const emailOk = !hasEmail || Boolean(req.user.isEmailVerified);
      const phoneOk = !hasPhone || Boolean(req.user.isPhoneVerified);
      if (!emailOk || !phoneOk) {
        riskFlags.push("unverified_account");
      }
    } catch {
      // ignore
    }

    // Basic fraud indicator: duplicate phone across accounts (best-effort; does not block).
    if (req.user?.phone) {
      try {
        const dupCount = await User.countDocuments({ phone: req.user.phone, _id: { $ne: req.user._id } });
        if (dupCount > 0) {
          riskFlags.push("duplicate_phone");
          await markUserSuspicious(req.user._id, {
            reason: "Duplicate phone detected",
            tags: ["duplicate_phone"],
          });
        }
      } catch {
        // ignore
      }
    }

    // Basic fraud indicator: many distinct users ordering from the same IP within a window.
    // Configurable and best-effort; intended to reduce fake/automated orders.
    const sharedIpWindowHours = Math.max(
      1,
      Number(orderSecurity.sharedIpWindowHours || parseIntEnv("ORDER_SHARED_IP_WINDOW_HOURS", 24))
    );
    const sharedIpMaxUsers = Math.max(
      2,
      Number(orderSecurity.sharedIpMaxUsers || parseIntEnv("ORDER_SHARED_IP_MAX_USERS", 3))
    );
    if (clientMeta.ipAddress) {
      const ipStart = new Date(Date.now() - sharedIpWindowHours * 60 * 60 * 1000);
      try {
        const rows = await Order.aggregate([
          { $match: { "client.ipAddress": clientMeta.ipAddress, createdAt: { $gte: ipStart } } },
          { $group: { _id: "$user" } },
          { $count: "uniqueUsers" },
        ]);
        const uniqueUsers = Number(rows?.[0]?.uniqueUsers || 0);
        if (uniqueUsers >= sharedIpMaxUsers) {
          riskFlags.push("shared_ip");
        }
      } catch {
        // ignore
      }
    }

    // Suspicious: multiple orders from same phone within a window (best-effort)
    const phoneRepeatWindowHours = Math.max(
      1,
      Number(orderSecurity.phoneRepeatWindowHours || parseIntEnv("ORDER_PHONE_REPEAT_WINDOW_HOURS", 24))
    );
    const phoneRepeatMaxOrders = Math.max(
      2,
      Number(orderSecurity.phoneRepeatMaxOrders || parseIntEnv("ORDER_PHONE_REPEAT_MAX_ORDERS", 2))
    );
    if (phoneDigits) {
      const start = new Date(Date.now() - phoneRepeatWindowHours * 60 * 60 * 1000);
      try {
        const count = await Order.countDocuments({
          $or: [{ "shippingAddress.phone": phoneDigits }, { "guestInfo.phone": phoneDigits }],
          createdAt: { $gte: start },
        });
        if (count >= phoneRepeatMaxOrders) {
          riskFlags.push("repeat_phone");
        }
      } catch {
        // ignore
      }
    }

    // Suspicious: multiple orders from same IP within a window (best-effort)
    const ipRepeatWindowHours = Math.max(
      1,
      Number(orderSecurity.ipRepeatWindowHours || parseIntEnv("ORDER_IP_REPEAT_WINDOW_HOURS", 24))
    );
    const ipRepeatMaxOrders = Math.max(
      2,
      Number(orderSecurity.ipRepeatMaxOrders || parseIntEnv("ORDER_IP_REPEAT_MAX_ORDERS", 4))
    );
    if (clientMeta.ipAddress) {
      const start = new Date(Date.now() - ipRepeatWindowHours * 60 * 60 * 1000);
      try {
        const count = await Order.countDocuments({
          "client.ipAddress": clientMeta.ipAddress,
          createdAt: { $gte: start },
        });
        if (count >= ipRepeatMaxOrders) {
          riskFlags.push("repeat_ip");
        }
      } catch {
        // ignore
      }
    }

    // Basic fraud indicator: shipping phone differs from account phone (best-effort; does not block).
    if (req.user) {
      try {
        const accountPhone = normalizePhone(req.user.phone);
        const shipPhone = normalizePhone(shippingAddress?.phone);
        if (accountPhone && shipPhone && accountPhone !== shipPhone) {
          riskFlags.push("phone_mismatch");
          if (orderSecurity.requireShippingPhoneMatchesAccount) {
            return res.status(400).json({
              success: false,
              message: "Shipping phone must match your account phone number",
            });
          }
          await markUserSuspicious(req.user._id, {
            reason: "Shipping phone differs from account phone",
            tags: ["phone_mismatch"],
          });
        }
      } catch {
        // ignore
      }
    }

    // Basic order frequency monitoring (anti-fake-order)
    const windowMinutes = Math.max(
      1,
      Number(orderSecurity.rateWindowMinutes || parseIntEnv("ORDER_RATE_WINDOW_MINUTES", 10))
    );
    const maxInWindow = Math.max(
      1,
      Number(orderSecurity.rateMaxInWindow || parseIntEnv("ORDER_RATE_MAX_IN_WINDOW", 3))
    );
    const dayHours = Math.max(
      1,
      Number(orderSecurity.rateDayHours || parseIntEnv("ORDER_RATE_DAY_HOURS", 24))
    );
    const maxPerDay = Math.max(
      1,
      Number(orderSecurity.rateMaxPerDay || parseIntEnv("ORDER_RATE_MAX_PER_DAY", 20))
    );

    const now = Date.now();
    const windowStart = new Date(now - windowMinutes * 60 * 1000);
    const dayStart = new Date(now - dayHours * 60 * 60 * 1000);

    if (req.user) {
      const [recentCount, dayCount] = await Promise.all([
        Order.countDocuments({ user: req.user._id, createdAt: { $gte: windowStart } }),
        Order.countDocuments({ user: req.user._id, createdAt: { $gte: dayStart } }),
      ]);

      if (recentCount >= maxInWindow || dayCount >= maxPerDay) {
        await markUserSuspicious(req.user._id, {
          reason: "High order frequency detected",
          tags: ["order_rate"],
        });

        return res.status(429).json({
          success: false,
          message: "Too many orders in a short time. Please wait and try again.",
        });
      }
    }

    // For authenticated users, get cart from database
    if (req.user) {
      // Validate shipping address for authenticated users
      if (
        !shippingAddress ||
        !shippingAddress.firstName ||
        !shippingAddress.phone ||
        !shippingAddress.streetAddress ||
        !shippingAddress.townCity
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Complete shipping address is required (firstName, phone, streetAddress, townCity)",
        });
      }

      const cart = await Cart.findOne({ user: req.user.id }).populate(
        "items.product"
      );

      // If cart is empty but orderItems provided, use orderItems with user authentication
      if (
        (!cart || cart.items.length === 0) &&
        orderItems &&
        orderItems.length > 0
      ) {
        // Fall through to process orderItems with authenticated user context
      } else if (!cart || cart.items.length === 0) {
        return res.status(400).json({
          success: false,
          message:
            "Your cart is empty. Please add items to your cart before checking out.",
        });
      } else {
        // Build order items from cart
        const cartOrderItems = cart.items.map((item) => ({
          product: item.product._id,
          name: item.product.name,
          image: item.product.images[0] || "/logo.jpeg",
          quantity: item.quantity,
          size: item.size,
          color: item.color,
          price: Number.isFinite(Number(item.price)) ? Number(item.price) : getEffectiveUnitPrice(item.product, item.quantity),
        }));

        const orderFingerprint = buildOrderFingerprint(cartOrderItems);
        const duplicateWindowHours = Math.max(
          1,
          Number(orderSecurity.duplicateOrderWindowHours || parseIntEnv("ORDER_DUPLICATE_WINDOW_HOURS", 6))
        );
        const duplicateStart = new Date(Date.now() - duplicateWindowHours * 60 * 60 * 1000);
        try {
          const duplicateCount = await Order.countDocuments({
            orderFingerprint,
            "shippingAddress.phone": shippingAddress?.phone,
            createdAt: { $gte: duplicateStart },
          });
          if (duplicateCount > 0) {
            riskFlags.push("duplicate_order");
            await markUserSuspicious(req.user._id, {
              reason: "Possible duplicate order detected",
              tags: ["duplicate_order"],
            });
          }
        } catch {
          // ignore
        }

        const riskScore = computeRiskScore(riskFlags);
        const approvalEnabled = parseBool(orderSecurity.enableRiskApproval);
        const enableRiskApproval = typeof approvalEnabled === "boolean" ? approvalEnabled : true;
        const approvalThreshold = Math.max(
          0,
          Number(orderSecurity.riskApprovalThreshold || parseIntEnv("ORDER_RISK_APPROVAL_THRESHOLD", 50))
        );
        const isSuspicious = riskFlags.includes("repeat_phone") || riskFlags.includes("repeat_ip") || riskFlags.includes("fake_name") || riskFlags.includes("duplicate_order") || riskFlags.includes("shared_ip") || riskFlags.includes("duplicate_phone") || riskFlags.includes("suspicious_user");
        const requiresApproval = enableRiskApproval ? (isSuspicious || riskScore >= approvalThreshold) : false;

        const blockSuspiciousOrdersSetting = parseBool(orderSecurity.blockSuspiciousOrders);
        const blockSuspiciousOrdersEnv = String(process.env.ORDER_BLOCK_SUSPICIOUS_ORDERS || "").toLowerCase() === "true";
        const blockSuspiciousOrders = (typeof blockSuspiciousOrdersSetting === "boolean" ? blockSuspiciousOrdersSetting : false) || blockSuspiciousOrdersEnv;
        if (blockSuspiciousOrders && isSuspicious) {
          return res.status(403).json({
            success: false,
            message: "Order flagged as suspicious and requires verification",
          });
        }

        // Apply combo free-delivery rule (server-side enforcement)
        const comboEligibility = computeComboFreeDeliveryEligibility(
          (cart.items || []).map((item) => ({ product: item.product, quantity: item.quantity }))
        );
        // Calculate totals based on product pricing snapshot (matches checkout)
        // - Original Price: based on product.originalPrice (or derived from discount%)
        // - Selling Price: product.price
        // - Discount: original - selling
        const pricing = computeCartPricingFromItems(cart.items || []);

        const advancePaymentAmount = Number(approvedAdvancePayment?.amount || 0);
        const advancePaymentStatus = (approvedAdvancePayment || req.user?.advanceVerified) ? "Verified" : "None";

        const baseDeliveryFee = getDeliveryFeeForCity(shippingAddress.townCity, paymentSettings);
        const normalizedDeliveryFee = Number.isFinite(baseDeliveryFee)
          ? Math.max(0, baseDeliveryFee)
          : 120;

        const qualifiesByAmount = pricing.effectiveSubtotal >= freeShippingThreshold;
        const totalPieces = (cart.items || []).reduce(
          (sum, item) => sum + Number(item?.quantity || 0),
          0
        );
        const qualifiesByQuantity = totalPieces >= FREE_DELIVERY_MIN_PIECES;

        const effectiveDeliveryFee = (comboEligibility.eligible || qualifiesByAmount || qualifiesByQuantity)
          ? 0
          : normalizedDeliveryFee;

        const subtotal = pricing.originalSubtotal;
        const discount = pricing.discountAmount;
        const total = pricing.effectiveSubtotal + effectiveDeliveryFee;

        const order = await Order.create({
          user: req.user ? req.user._id : null,
          isGuestOrder: !Boolean(req.user),
          guestInfo: {
            email: String(req.user?.email || shippingAddress.email || "").trim(),
            phone: shippingAddress.phone,
          },
          orderItems: cartOrderItems,
          shippingAddress,
          paymentMethod: normalizedPaymentMethod,
          subtotal,
          discount,
          deliveryFee: effectiveDeliveryFee,
          total,
          totalAmount: total,
          advancePaid: advancePaymentAmount,
          dueAmount: Math.max(total - advancePaymentAmount, 0),
          orderStatus: isAdvanceRequired ? "PendingPayment" : "pending",
          advancePaymentRequired: isAdvanceRequired,
          advancePaymentStatus: isAdvanceRequired ? "Pending" : advancePaymentStatus,
          pricingVersion: 2,
          client: clientMeta,
          orderFingerprint,
          riskScore,
          riskFlags,
          isSuspicious,
          requiresApproval,
          approval: {
            status: requiresApproval ? "pending" : "none",
          },
        });

        if (approvedAdvancePayment) {
          approvedAdvancePayment.usedAt = new Date();
          approvedAdvancePayment.usedForOrderId = order._id;
          await approvedAdvancePayment.save();
        }

        if (req.user?.advanceVerified) {
          await User.findByIdAndUpdate(req.user._id, {
            advanceVerified: false,
            advanceVerifiedAt: null,
            advanceVerifiedBy: null,
          });
        }

        // Update product stock
        for (const item of cart.items) {
          await Product.findByIdAndUpdate(item.product._id, {
            $inc: { stock: -item.quantity },
          });
        }

        // Clear cart
        cart.items = [];
        await cart.save();

        await order.populate("orderItems.product", "name images");

        // Meta Conversions API Purchase (best-effort)
        if (order.paymentMethod !== "sslcommerz") {
          await sendMetaCapiPurchase({ req, order, eventId: clientMeta.metaEventId });
        }

        // Notify admin via Web Push (best-effort)
        // IMPORTANT: On serverless (e.g., Vercel), fire-and-forget async work is often
        // terminated as soon as the HTTP response is finalized. Awaiting here ensures
        // the push is actually sent even if the admin site is closed.
        try {
          await webPushService.notifyAdminNewOrder(order);
        } catch {
          // ignore
        }

        // Auto-sync to Google Sheets (async, non-blocking)
        googleSheetsService.initialize().then((initialized) => {
          if (initialized) {
            googleSheetsService.syncOrder(order, Order).catch((err) => {
            });
          }
        });

        // SSLCommerz: initiate payment and return redirect URL
        if (order.paymentMethod === "sslcommerz") {
          try {
            const tranId = `DW_${order.orderNumber || order._id}`;
            order.paymentDetails = {
              ...(order.paymentDetails || {}),
              provider: "sslcommerz",
              tranId,
              initiatedAt: new Date(),
            };
            await order.save();

            const init = await initiatePayment({ req, order });
            order.paymentDetails = {
              ...(order.paymentDetails || {}),
              provider: "sslcommerz",
              tranId: String(init?.tranId || tranId),
              initiatedAt: order.paymentDetails?.initiatedAt || new Date(),
              lastGatewayResponse: {
                type: "init",
                at: new Date().toISOString(),
                gateway: init?.gateway || null,
              },
            };
            await order.save();

            const redirectUrl = init?.gateway?.GatewayPageURL || "";
            if (!redirectUrl) {
              return res.status(502).json({
                success: false,
                message: "Failed to initiate SSLCommerz payment",
              });
            }

            return res.status(201).json({
              success: true,
              order,
              payment: {
                provider: "sslcommerz",
                tranId: order.paymentDetails?.tranId,
                redirectUrl,
              },
            });
          } catch (err) {
            console.error("[SSLCommerz] initiate error:", err);
            order.paymentStatus = "failed";
            order.paymentDetails = {
              ...(order.paymentDetails || {}),
              provider: "sslcommerz",
              lastGatewayResponse: {
                type: "init_error",
                at: new Date().toISOString(),
                error: String(err?.message || "Initiation failed"),
              },
            };
            try {
              await order.save();
            } catch {
              // ignore
            }

            return res.status(err?.statusCode || 502).json({
              success: false,
              message: err?.message || "Failed to initiate SSLCommerz payment",
            });
          }
        }

        return res.status(201).json({
          success: true,
          order,
          needsAdvance: isAdvanceRequired,
        });
      }
    }

    // For guest orders or authenticated users with orderItems, use orderItems from request body
    if (!orderItems || orderItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Order items are required",
      });
    }

    // Validate shipping address
    if (
      !shippingAddress ||
      !shippingAddress.firstName ||
      !shippingAddress.phone ||
      !shippingAddress.streetAddress ||
      !shippingAddress.townCity
    ) {
      return res.status(400).json({
        success: false,
        message: "Complete shipping address is required",
      });
    }

    // Validate email section removed for guest orders

    // Validate products and calculate totals
    const validatedOrderItems = [];
    let originalSubtotal = 0;
    let effectiveSubtotal = 0;
    const productsForEligibility = [];

    for (const item of orderItems) {
      const qty = Number(item.quantity || 0);
      if (!Number.isFinite(qty) || qty < 1) {
        return res.status(400).json({
          success: false,
          message: "Each order item must have a valid quantity",
        });
      }

      if (!item.size || !String(item.size).trim()) {
        return res.status(400).json({
          success: false,
          message: "Each order item must include a size",
        });
      }

      if (!item.color || !String(item.color).trim()) {
        return res.status(400).json({
          success: false,
          message: "Each order item must include a color",
        });
      }

      const product = await Product.findById(item.product || item.productId);

      if (!product || !product.isActive) {
        return res.status(400).json({
          success: false,
          message: `Product ${item.name || "unknown"} is not available`,
        });
      }

      // Check stock
      if (product.stock < qty) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.name}`,
        });
      }

      validatedOrderItems.push({
        product: product._id,
        name: product.name,
        image: item.image || product.images[0] || "/logo.jpeg",
        quantity: qty,
        size: String(item.size).trim(),
        color: String(item.color).trim(),
        price: getEffectiveUnitPrice(product, qty),
      });

      productsForEligibility.push({ product, quantity: qty });

      const unitEffective = Number(product.price || 0);
      const unitOriginal = computeUnitOriginal(unitEffective, product.originalPrice, product.discount);

      originalSubtotal += unitOriginal * qty;
      effectiveSubtotal += unitEffective * qty;
    }

    const comboEligibility = computeComboFreeDeliveryEligibility(productsForEligibility);
    const baseDeliveryFee = Number(deliveryFee);
    const normalizedDeliveryFee = Number.isFinite(baseDeliveryFee)
      ? Math.max(0, baseDeliveryFee)
      : Number(settings?.defaultDeliveryFee || 15);

    const qualifiesByAmount = effectiveSubtotal >= freeShippingThreshold;
    const totalPieces = (validatedOrderItems || []).reduce(
      (sum, item) => sum + Number(item?.quantity || 0),
      0
    );
    const qualifiesByQuantity = totalPieces >= FREE_DELIVERY_MIN_PIECES;

    const effectiveDeliveryFee = (comboEligibility.eligible || qualifiesByAmount || qualifiesByQuantity)
      ? 0
      : normalizedDeliveryFee;

    const discount = Math.max(originalSubtotal - effectiveSubtotal, 0);
    const total = effectiveSubtotal + effectiveDeliveryFee;

    // Prepare order data - set user ID if authenticated, otherwise create guest order
    const blockedForCOD = hasCancelledOrderHistory && normalizedPaymentMethod === "cash";

    const advancePaymentAmount = Number(approvedAdvancePayment?.amount || 0);
    const advancePaymentStatus = approvedAdvancePayment ? "Verified" : "None";
    const requestedAdvancePaidAmount = Number(advancePaidAmount || 0);
    const isAdvanceFullPayment = normalizedPaymentMethod === 'advance';
    const actualPaymentMethod = isAdvanceFullPayment ? advancePaymentMethod : normalizedPaymentMethod;
    const effectiveAdvancePaidAmount = isAdvanceFullPayment
      ? requestedAdvancePaidAmount
      : advancePaymentAmount;

    if (isAdvanceFullPayment && effectiveAdvancePaidAmount !== total) {
      return res.status(400).json({
        success: false,
        message: effectiveAdvancePaidAmount < total
          ? "You have paid less than the total amount"
          : "Paid amount cannot exceed total amount",
      });
    }

    const advanceStatus = isAdvanceFullPayment ? 'Verified' : isAdvanceRequired ? 'Pending' : advancePaymentStatus;
    const paymentStatus = isAdvanceFullPayment ? 'paid' : (normalizedPaymentMethod === 'sslcommerz' ? 'pending' : 'pending');

    const orderData = {
      orderItems: validatedOrderItems,
      shippingAddress,
      paymentMethod: actualPaymentMethod,
      subtotal: originalSubtotal,
      discount,
      deliveryFee: effectiveDeliveryFee,
      total,
      totalAmount: total,
      advancePaid: effectiveAdvancePaidAmount,
      dueAmount: isAdvanceFullPayment ? 0 : Math.max(total - effectiveAdvancePaidAmount, 0),
      orderStatus: isAdvanceFullPayment ? 'pending' : (isAdvanceRequired ? 'PendingPayment' : 'pending'),
      advancePaymentRequired: isAdvanceFullPayment ? false : isAdvanceRequired,
      advancePaymentStatus: advanceStatus,
      paymentStatus,
      paidAt: isAdvanceFullPayment ? new Date() : null,
      pricingVersion: 2,
      ...(isAdvanceFullPayment && {
        advancePayment: {
          paymentMethod: advancePaymentMethod,
          senderNumber: advanceSenderNumber,
          transactionId: advancePaymentTransactionId,
          last4: advancePaymentLast4,
          amount: effectiveAdvancePaidAmount,
          paidAt: new Date(),
          status: 'Verified',
        },
        paymentDetails: {
          provider: 'mobilebanking',
          tranId: '',
          amount: effectiveAdvancePaidAmount,
          currency: 'BDT',
          initiatedAt: new Date(),
          validatedAt: new Date(),
          lastGatewayResponse: null,
        },
      }),
    };

    // Add user-specific or guest-specific fields
    if (req.user) {
      orderData.user = req.user.id;
      orderData.isGuestOrder = false;
      if (blockedForCOD) {
        await User.findByIdAndUpdate(req.user._id, {
          isBlockedForCOD: true,
          blockedForCODAt: new Date(),
        });
      }
    } else {
      orderData.user = undefined;
      orderData.isGuestOrder = true;
      orderData.guestInfo = {
        email: shippingAddress?.email ? String(shippingAddress.email).trim().toLowerCase() : "",
        phone: phoneDigits,
      };
    }

    const orderFingerprint = buildOrderFingerprint(validatedOrderItems);
    orderData.client = clientMeta;
    orderData.orderFingerprint = orderFingerprint;

    const duplicateWindowHours = Math.max(
      1,
      Number(orderSecurity.duplicateOrderWindowHours || parseIntEnv("ORDER_DUPLICATE_WINDOW_HOURS", 6))
    );
    const duplicateStart = new Date(Date.now() - duplicateWindowHours * 60 * 60 * 1000);
    try {
      const duplicateCount = await Order.countDocuments({
        orderFingerprint,
        "shippingAddress.phone": shippingAddress?.phone,
        createdAt: { $gte: duplicateStart },
      });
      if (duplicateCount > 0) {
        riskFlags.push("duplicate_order");
        if (req.user) {
          await markUserSuspicious(req.user._id, {
            reason: "Possible duplicate order detected",
            tags: ["duplicate_order"],
          });
        }
      }
    } catch {
      // ignore
    }

    const riskScore = computeRiskScore(riskFlags);
    const approvalEnabled = parseBool(orderSecurity.enableRiskApproval);
    const enableRiskApproval = typeof approvalEnabled === "boolean" ? approvalEnabled : true;
    const approvalThreshold = Math.max(
      0,
      Number(orderSecurity.riskApprovalThreshold || parseIntEnv("ORDER_RISK_APPROVAL_THRESHOLD", 50))
    );
    const isSuspicious = riskFlags.includes("repeat_phone") || riskFlags.includes("repeat_ip") || riskFlags.includes("fake_name") || riskFlags.includes("duplicate_order") || riskFlags.includes("shared_ip") || riskFlags.includes("duplicate_phone") || riskFlags.includes("suspicious_user");
    const requiresApproval = enableRiskApproval ? (isSuspicious || riskScore >= approvalThreshold) : false;

    const blockSuspiciousOrdersSetting = parseBool(orderSecurity.blockSuspiciousOrders);
    const blockSuspiciousOrdersEnv = String(process.env.ORDER_BLOCK_SUSPICIOUS_ORDERS || "").toLowerCase() === "true";
    const blockSuspiciousOrders = (typeof blockSuspiciousOrdersSetting === "boolean" ? blockSuspiciousOrdersSetting : false) || blockSuspiciousOrdersEnv;
    if (blockSuspiciousOrders && isSuspicious) {
      return res.status(403).json({
        success: false,
        message: "Order flagged as suspicious and requires verification",
      });
    }
    orderData.riskScore = riskScore;
    orderData.riskFlags = riskFlags;
    orderData.isSuspicious = isSuspicious;
    orderData.requiresApproval = requiresApproval;
    orderData.approval = { status: requiresApproval ? "pending" : "none" };

    // Create order
    console.log('[ORDER_CREATE_BEFORE_SAVE]', {
      timestamp: new Date().toISOString(),
      isGuest: orderData.isGuestOrder,
      itemCount: orderData.orderItems?.length || 0,
      total: orderData.total,
      phone: orderData.guestInfo?.phone || orderData.shippingAddress?.phone,
    });

    const order = await Order.create(orderData);

    console.log('[ORDER_CREATE_AFTER_SAVE]', {
      timestamp: new Date().toISOString(),
      orderId: order._id?.toString(),
      orderNumber: order.orderNumber,
      shortId: order.shortId,
      isGuestOrder: order.isGuestOrder,
      success: Boolean(order._id),
    });

    if (approvedAdvancePayment) {
      approvedAdvancePayment.usedAt = new Date();
      approvedAdvancePayment.usedForOrderId = order._id;
      await approvedAdvancePayment.save();
    }

    if (req.user?.advanceVerified) {
      await User.findByIdAndUpdate(req.user._id, {
        advanceVerified: false,
        advanceVerifiedAt: null,
        advanceVerifiedBy: null,
      });
    }

    // Update product stock
    for (const item of validatedOrderItems) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: -item.quantity },
      });
    }

    // Clear cart for authenticated users
    if (req.user) {
      const cart = await Cart.findOne({ user: req.user.id });
      if (cart) {
        cart.items = [];
        await cart.save();
      }
    }

    await order.populate("orderItems.product", "name images");

    // Meta Conversions API Purchase (best-effort)
    if (order.paymentMethod !== "sslcommerz") {
      await sendMetaCapiPurchase({ req, order, eventId: clientMeta.metaEventId });
    }

    // Notify admin via Web Push (best-effort)
    // IMPORTANT: On serverless (e.g., Vercel), fire-and-forget async work is often
    // terminated as soon as the HTTP response is finalized. Awaiting here ensures
    // the push is actually sent even if the admin site is closed.
    try {
      await webPushService.notifyAdminNewOrder(order);
    } catch {
      // ignore
    }

    // Create centralized admin notification for the new order.
    try {
      await Notification.create({
        recipientType: "admin",
        type: "order",
        title: "New order placed",
        message: `New order ${order.orderNumber ? `#${order.orderNumber}` : String(order._id).slice(-8)} placed by ${String(order.shippingAddress?.firstName || order.shippingAddress?.phone || "guest").trim()}`,
        referenceId: String(order._id),
        data: {
          orderId: String(order._id),
          orderNumber: order.orderNumber || null,
          customerName: `${String(order.shippingAddress?.firstName || "").trim()} ${String(order.shippingAddress?.lastName || "").trim()}`.trim(),
          customerPhone: String(order.shippingAddress?.phone || order.guestInfo?.phone || "").trim(),
          total: Number(order.total || 0),
          paymentMethod: String(order.paymentMethod || "").trim(),
        },
      });
    } catch {
      // Best-effort only
    }

    // Auto-sync to Google Sheets (async, non-blocking)
    googleSheetsService.initialize().then((initialized) => {
      if (initialized) {
        googleSheetsService.syncOrder(order, Order).catch((err) => {
        });
      }
    });

    // SSLCommerz: initiate payment and return redirect URL
    if (order.paymentMethod === "sslcommerz") {
      try {
        const tranId = `DW_${order.orderNumber || order._id}`;
        order.paymentDetails = {
          ...(order.paymentDetails || {}),
          provider: "sslcommerz",
          tranId,
          initiatedAt: new Date(),
        };
        await order.save();

        const init = await initiatePayment({ req, order });
        order.paymentDetails = {
          ...(order.paymentDetails || {}),
          provider: "sslcommerz",
          tranId: String(init?.tranId || tranId),
          initiatedAt: order.paymentDetails?.initiatedAt || new Date(),
          lastGatewayResponse: {
            type: "init",
            at: new Date().toISOString(),
            gateway: init?.gateway || null,
          },
        };
        await order.save();

        const redirectUrl = init?.gateway?.GatewayPageURL || "";
        if (!redirectUrl) {
          return res.status(502).json({
            success: false,
            message: "Failed to initiate SSLCommerz payment",
          });
        }

        return res.status(201).json({
          success: true,
          order,
          payment: {
            provider: "sslcommerz",
            tranId: order.paymentDetails?.tranId,
            redirectUrl,
          },
        });
      } catch (err) {
        console.error("[SSLCommerz] initiate error:", err);
        order.paymentStatus = "failed";
        order.paymentDetails = {
          ...(order.paymentDetails || {}),
          provider: "sslcommerz",
          lastGatewayResponse: {
            type: "init_error",
            at: new Date().toISOString(),
            error: String(err?.message || "Initiation failed"),
          },
        };
        try {
          await order.save();
        } catch {
          // ignore
        }

        return res.status(err?.statusCode || 502).json({
          success: false,
          message: err?.message || "Failed to initiate SSLCommerz payment",
        });
      }
    }

    console.log('[ORDER_CREATE_FINAL_RESPONSE]', {
      timestamp: new Date().toISOString(),
      orderId: order._id?.toString(),
      orderNumber: order.orderNumber,
      isGuestOrder: order.isGuestOrder,
      phone: order.shippingAddress?.phone,
      success: true,
      responseStatus: 201,
    });

    return res.status(201).json({
      success: true,
      order,
      needsAdvance: isAdvanceRequired,
    });
  } catch (error) {
    console.error('[ORDER_CREATE_ERROR]', {
      timestamp: new Date().toISOString(),
      message: error?.message,
      code: error?.code,
      statusCode: error?.statusCode,
      stack: error?.stack?.split('\n')[0],
    });
    next(error);
  }
};

// @desc    Track guest order by phone and order ID
// @route   POST /api/orders/track-guest
// @access  Public
exports.trackGuestOrder = async (req, res, next) => {
  try {
    const { phone, orderId } = req.body;

    if (!phone || !orderId) {
      return res.status(400).json({
        success: false,
        message: "Phone number and Order ID are required",
      });
    }

    const normalizedPhone = normalizePhone(phone);

    // Find order by ID and phone number (accept normalized)
    const order = await Order.findOne({
      _id: orderId,
      isGuestOrder: true,
      $or: [
        { "shippingAddress.phone": phone },
        { "shippingAddress.phone": normalizedPhone },
      ],
    }).populate("orderItems.product", "name images");

    if (!order) {
      return res.status(404).json({
        success: false,
        message:
          "Order not found. Please check your Order ID and phone number.",
      });
    }

    res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Track orders by phone number only
// @route   POST /api/orders/track-by-phone
// @access  Public
exports.trackOrdersByPhone = async (req, res, next) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    const normalizedPhone = normalizePhone(phone);

    // Find all orders with this phone number
    const orders = await Order.find({
      $or: [
        { "shippingAddress.phone": phone },
        { "shippingAddress.phone": normalizedPhone },
        { "guestInfo.phone": phone },
        { "guestInfo.phone": normalizedPhone },
      ],
    })
      .sort({ createdAt: -1 })
      .populate("orderItems.product", "name images")
      .select("-__v");

    if (!orders || orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No orders found for this phone number.",
      });
    }

    // Return all orders for this phone number
    res.status(200).json({
      success: true,
      count: orders.length,
      orders: orders.map((order) => ({
        orderId: order.orderNumber || order._id.toString().slice(-8).toUpperCase(),
        _id: order._id,
        orderDate: order.createdAt,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        orderStatus: order.orderStatus,
        deliveryStatus: order.deliveryStatus || order.orderStatus,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        shippingAddress: order.shippingAddress,
        orderItems: order.orderItems,
        subtotal: order.subtotal,
        discount: order.discount,
        deliveryFee: order.deliveryFee,
        total: order.total,
        pathaoConsignmentId: order.pathaoConsignmentId,
        pathaoOrderId: order.pathaoOrderId,
        trackingHistory: order.trackingHistory || [],
        lastStatusUpdate: order.lastStatusUpdate || order.updatedAt,
        deliveredAt: order.deliveredAt,
        cancelledAt: order.cancelledAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get user orders (or all orders for admin)
// @route   GET /api/orders
// @access  Private
exports.getOrders = async (req, res, next) => {
  try {
    // If user is admin, return all orders; otherwise return only user's orders.
    // Phone is the primary identifier: if the user's phone is unique, also include orders by phone.
    let query;
    if (req.user.role === "admin") {
      query = {};
    } else {
      const userId = req.user.id;
      const phone = normalizePhone(req.user.phone);

      let includePhone = false;
      if (phone) {
        try {
          const dup = await User.countDocuments({ phone, _id: { $ne: userId } });
          includePhone = dup === 0;
        } catch {
          includePhone = false;
        }
      }

      query = includePhone
        ? {
          $or: [
            { user: userId },
            { "shippingAddress.phone": phone },
            { "guestInfo.phone": phone },
          ],
        }
        : { user: userId };
    }

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .populate("orderItems.product", "name images category")
      .populate("user", "firstName lastName email");

    // Backfill missing order numbers for legacy orders
    for (const order of orders) {
      if (!order.orderNumber) {
        await ensureOrderNumber(order);
      }
    }

    res.status(200).json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single order
// @route   GET /api/orders/:id
// @access  Private
exports.getOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate(
      "orderItems.product",
      "name images price category"
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Authorization:
    // - Admin can access any
    // - Non-admin must either own the order OR have a unique phone matching the order phone
    if (req.user.role !== "admin") {
      const userId = String(req.user.id);
      const owns = order.user && String(order.user) === userId;

      if (!owns) {
        const userPhone = normalizePhone(req.user.phone);
        let phoneUnique = false;
        if (userPhone) {
          try {
            const dup = await User.countDocuments({ phone: userPhone, _id: { $ne: req.user.id } });
            phoneUnique = dup === 0;
          } catch {
            phoneUnique = false;
          }
        }

        const orderPhone = normalizePhone(order.shippingAddress?.phone || order.guestInfo?.phone || "");
        const phoneMatch = phoneUnique && userPhone && orderPhone && userPhone === orderPhone;

        if (!phoneMatch) {
          return res.status(403).json({
            success: false,
            message: "Not authorized to access this order",
          });
        }
      }
    }

    await ensureOrderNumber(order);

    res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { orderStatus } = req.body;

    const ALLOWED_ORDER_STATUSES = new Set([
      "pending",
      "confirmed",
      "processing",
      "hold",
      "shipped",
      "delivered",
      "paid_return",
      "cancelled",
    ]);

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (
      order?.requiresApproval &&
      order?.approval?.status === "pending" &&
      ["confirmed", "processing", "hold", "shipped", "delivered"].includes(String(orderStatus || "").toLowerCase())
    ) {
      return res.status(400).json({
        success: false,
        message: "Order requires admin approval before processing",
      });
    }

    const nextOrderStatus = String(orderStatus || "").toLowerCase();

    if (!ALLOWED_ORDER_STATUSES.has(nextOrderStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order status",
      });
    }

    const prevOrderStatus = String(order.orderStatus || "pending").toLowerCase();

    const mapOrderStatusToDeliveryStatus = (s) => {
      switch (String(s || "").toLowerCase()) {
        case "pending":
          return "placed";
        case "confirmed":
          return "confirmed";
        case "processing":
          return "confirmed";
        case "hold":
          return "confirmed";
        case "shipped":
          return "in_transit";
        case "delivered":
          return "delivered";
        case "paid_return":
          return "cancelled";
        case "cancelled":
          return "cancelled";
        default:
          return "placed";
      }
    };

    order.orderStatus = nextOrderStatus;
    order.lastStatusUpdate = new Date();

    // For non-Pathao orders, keep deliveryStatus aligned with orderStatus so customer tracking stays accurate.
    const hasPathao = Boolean(order?.pathaoConsignmentId || order?.pathaoOrderId);
    if (!hasPathao) {
      order.deliveryStatus = mapOrderStatusToDeliveryStatus(nextOrderStatus);
    }

    // Append tracking history entry for visibility on the tracking page.
    order.trackingHistory = Array.isArray(order.trackingHistory) ? order.trackingHistory : [];
    order.trackingHistory.push({
      status: hasPathao ? String(order.deliveryStatus || "placed") : String(order.deliveryStatus || "placed"),
      message: `Order status updated to ${nextOrderStatus}`,
      timestamp: new Date(),
    });

    if (nextOrderStatus === "delivered") {
      order.deliveredAt = new Date();
    }

    const isCancellationLike = (s) => ["cancelled", "paid_return"].includes(String(s || "").toLowerCase());
    if (isCancellationLike(nextOrderStatus)) {
      order.cancelledAt = new Date();

      // Restore stock only once when transitioning into a cancellation-like state.
      if (!isCancellationLike(prevOrderStatus)) {
        for (const item of order.orderItems || []) {
          await Product.findByIdAndUpdate(item.product, {
            $inc: { stock: item.quantity },
          });
        }

        if (await shouldBlockUserForFirstCodCancel(order)) {
          await User.findByIdAndUpdate(order.user, {
            isBlockedForCOD: true,
            blockedForCODAt: new Date(),
          });
        }
      }
    }

    await order.save();

    // Create customer notification + Web Push (best-effort)
    try {
      const userId = order.user;
      const statusMessageMap = {
        pending: "Your order has been received",
        confirmed: "Your order has been confirmed",
        processing: "Your order is being prepared",
        shipped: "Your order has been shipped",
        delivered: "Your order has been delivered",
        cancelled: "Your order has been cancelled",
        paid_return: "Your order has been cancelled",
      };

      const message =
        statusMessageMap[nextOrderStatus] || `Your order status updated to ${nextOrderStatus}`;

      const primaryProductName = (() => {
        const names = (order.orderItems || []).map((x) => String(x?.name || "").trim()).filter(Boolean);
        if (names.length === 0) return "";
        if (names.length === 1) return names[0];
        return `${names[0]} +${names.length - 1} more`;
      })();

      const baseData = {
        orderId: String(order._id),
        orderNumber: order.orderNumber || null,
        shortId: order.shortId || "",
        status: nextOrderStatus,
        prevStatus: prevOrderStatus,
        productName: primaryProductName,
        totalPrice: typeof order.total === "number" ? order.total : Number(order.total || 0),
      };

      const orderLabel = order.orderNumber
        ? `#${order.orderNumber}`
        : order.shortId
          ? `#${order.shortId}`
          : String(order._id || "").slice(-8);

      const totalLabel = (() => {
        const t = typeof order.total === "number" ? order.total : Number(order.total || 0);
        if (!Number.isFinite(t)) return "৳0";
        return `৳${Math.round(t) === t ? t : t.toFixed(2)}`;
      })();

      const detailedMessage = [
        message,
        orderLabel ? `Order ${orderLabel}` : null,
        primaryProductName || null,
        `Status: ${nextOrderStatus}`,
        `Total: ${totalLabel}`,
      ]
        .filter(Boolean)
        .join(" · ");

      if (userId) {
        await Notification.create({
          user: userId,
          type: "order_status",
          title: "Order Status Updated",
          message: detailedMessage,
          data: baseData,
        });

        try {
          await webPushService.notifyUserOrderStatus({
            userId,
            order,
            nextStatus: nextOrderStatus,
            message: detailedMessage,
          });
        } catch {
          // ignore
        }
      } else if (order?.isGuestOrder) {
        const guestPhone = normalizePhone(order?.guestInfo?.phone || order?.shippingAddress?.phone || "");
        if (guestPhone && isValidBdPhone(guestPhone)) {
          await Notification.create({
            guestPhone,
            order: order._id,
            type: "order_status",
            title: "Order Status Updated",
            message: detailedMessage,
            data: baseData,
          });

          try {
            await webPushService.notifyGuestOrderStatus({
              order,
              nextStatus: nextOrderStatus,
              message: detailedMessage,
            });
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }

    res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Approve high-risk order
// @route   PUT /api/orders/:id/approve
// @access  Private/Admin
exports.approveOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    order.requiresApproval = false;
    order.approval = {
      ...(order.approval || {}),
      status: "approved",
      approvedAt: new Date(),
      approvedBy: req.user._id,
    };

    if (order.orderStatus === "pending_approval" || order.advancePaymentRequired) {
      order.orderStatus = "confirmed";
      order.advancePaymentStatus = "Verified";
      order.advancePaymentRequired = false;
    }

    await order.save();

    res.status(200).json({ success: true, order });
  } catch (error) {
    next(error);
  }
};

// @desc    Reject high-risk order (cancels it)
// @route   PUT /api/orders/:id/reject
// @access  Private/Admin
exports.rejectOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (order.orderStatus === "delivered") {
      return res.status(400).json({
        success: false,
        message: "Delivered orders cannot be rejected",
      });
    }

    if (order.orderStatus !== "cancelled") {
      order.orderStatus = "cancelled";
      order.cancelledAt = new Date();

      for (const item of order.orderItems || []) {
        await Product.findByIdAndUpdate(item.product, {
          $inc: { stock: item.quantity },
        });
      }
    }

    order.requiresApproval = false;
    order.approval = {
      ...(order.approval || {}),
      status: "rejected",
      rejectedAt: new Date(),
      rejectedBy: req.user._id,
    };

    await order.save();

    // Create customer notification + Web Push (best-effort)
    try {
      const userId = order.user;
      const nextStatus = String(order.orderStatus || "cancelled").toLowerCase();
      const message = "Your order has been cancelled";

      const primaryProductName = (() => {
        const names = (order.orderItems || []).map((x) => String(x?.name || "").trim()).filter(Boolean);
        if (names.length === 0) return "";
        if (names.length === 1) return names[0];
        return `${names[0]} +${names.length - 1} more`;
      })();

      const baseData = {
        orderId: String(order._id),
        orderNumber: order.orderNumber || null,
        shortId: order.shortId || "",
        status: nextStatus,
        productName: primaryProductName,
        totalPrice: typeof order.total === "number" ? order.total : Number(order.total || 0),
      };

      const orderLabel = order.orderNumber
        ? `#${order.orderNumber}`
        : order.shortId
          ? `#${order.shortId}`
          : String(order._id || "").slice(-8);

      const totalLabel = (() => {
        const t = typeof order.total === "number" ? order.total : Number(order.total || 0);
        if (!Number.isFinite(t)) return "৳0";
        return `৳${Math.round(t) === t ? t : t.toFixed(2)}`;
      })();

      const detailedMessage = [
        message,
        orderLabel ? `Order ${orderLabel}` : null,
        primaryProductName || null,
        `Status: ${nextStatus}`,
        `Total: ${totalLabel}`,
      ]
        .filter(Boolean)
        .join(" · ");

      if (userId) {
        await Notification.create({
          user: userId,
          type: "order_status",
          title: "Order Status Updated",
          message: detailedMessage,
          data: baseData,
        });

        try {
          await webPushService.notifyUserOrderStatus({
            userId,
            order,
            nextStatus,
            message: detailedMessage,
          });
        } catch {
          // ignore
        }
      } else if (order?.isGuestOrder) {
        const guestPhone = normalizePhone(order?.guestInfo?.phone || order?.shippingAddress?.phone || "");
        if (guestPhone && isValidBdPhone(guestPhone)) {
          await Notification.create({
            guestPhone,
            order: order._id,
            type: "order_status",
            title: "Order Status Updated",
            message: detailedMessage,
            data: baseData,
          });

          try {
            await webPushService.notifyGuestOrderStatus({
              order,
              nextStatus,
              message: detailedMessage,
            });
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }

    res.status(200).json({ success: true, order });
  } catch (error) {
    next(error);
  }
};

// @desc    Record that an admin sent a WhatsApp message for this order
// @route   POST /api/orders/:id/whatsapp-sent
// @access  Private/Admin
exports.markWhatsAppSent = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    order.whatsappLastSentAt = new Date();
    await order.save();

    return res.status(200).json({ success: true, order });
  } catch (error) {
    next(error);
  }
};

// @desc    Sync orders to Google Sheets (only unsynced orders)
// @route   POST /api/orders/sync-sheets
// @access  Private/Admin
exports.syncOrdersToSheets = async (req, res, next) => {
  try {
    const { date, orderIds, syncAll = false } = req.body;

    // Initialize Google Sheets
    const initialized = await googleSheetsService.initialize();
    if (!initialized) {
      return res.status(503).json({
        success: false,
        message:
          "Google Sheets service not configured. Please add credentials to .env file.",
      });
    }

    let query = {};

    // Only sync unsynced orders by default (unless syncAll is true)
    if (!syncAll) {
      query.syncedToSheet = { $ne: true };
    }

    // If specific order IDs provided
    if (orderIds && orderIds.length > 0) {
      query._id = { $in: orderIds };
    }
    // If date filter provided
    else if (date) {
      const targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(targetDate);
      nextDay.setDate(nextDay.getDate() + 1);

      query.createdAt = {
        $gte: targetDate,
        $lt: nextDay,
      };
    }

    const orders = await Order.find(query).populate(
      "orderItems.product",
      "name images"
    );

    if (!orders || orders.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No new orders to sync",
        stats: {
          total: 0,
          synced: 0,
          skipped: 0,
          failed: 0,
        },
      });
    }

    // Sync to Google Sheets (pass Order model for updating sync status)
    const result = await googleSheetsService.syncOrders(orders, Order);

    res.status(200).json({
      success: true,
      message: result.message,
      stats: {
        total: orders.length,
        synced: result.synced,
        skipped: result.skipped,
        failed: result.failed,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get count of unsynced orders
// @route   GET /api/orders/unsynced-count
// @access  Private/Admin
exports.getUnsyncedCount = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query || {};

    const query = {
      syncedToSheet: { $ne: true },
    };

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        if (Number.isNaN(start.getTime())) {
          return res.status(400).json({ success: false, message: "Invalid startDate" });
        }
        query.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        if (Number.isNaN(end.getTime())) {
          return res.status(400).json({ success: false, message: "Invalid endDate" });
        }
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const count = await Order.countDocuments(query);

    res.status(200).json({
      success: true,
      count,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Export filtered orders to Google Sheets
// @route   POST /api/orders/export-to-sheets
// @access  Private/Admin
exports.exportOrdersToSheets = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.body;

    // Build query - Only fetch unsynced orders
    let query = {
      syncedToSheet: { $ne: true }, // Only get orders not yet synced
    };

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const endDateTime = new Date(endDate);
        endDateTime.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endDateTime;
      }
    }

    // Fetch orders
    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .populate("orderItems.product", "name")
      .populate("user", "firstName lastName");

    if (orders.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No orders found for the selected date range",
        ordersCount: 0,
        itemsCount: 0,
        sheetUrl: null,
      });
    }

    // Prepare data for Google Sheets
    const exportHeaders = [
      "Order ID",
      "Customer ID",
      "Customer Name",
      "Location",
      "Product Name",
      "Quantity",
      "Color",
      "Price",
    ];

    const exportRows = [];

    let itemsCount = 0;
    orders.forEach((order) => {
      const orderId = order.orderNumber || "N/A";
      const customerId = order.user?._id?.toString() || "Guest";
      const customerName = `${order.shippingAddress?.firstName || order.user?.firstName || ""
        } ${order.shippingAddress?.lastName || order.user?.lastName || ""}`.trim();
      const location = [
        order.shippingAddress?.streetAddress,
        order.shippingAddress?.townCity,
        order.shippingAddress?.state,
        order.shippingAddress?.zipCode,
      ]
        .filter(Boolean)
        .join(", ");

      const productNames = (order.orderItems || [])
        .map((item) => item.name)
        .filter(Boolean)
        .join(", ");
      const quantities = (order.orderItems || [])
        .map((item) => item.quantity)
        .filter((value) => value !== undefined && value !== null)
        .join(", ");
      const colors = (order.orderItems || [])
        .map((item) => item.color)
        .filter(Boolean)
        .join(", ");

      exportRows.push([
        orderId,
        customerId,
        customerName || "N/A",
        location || "N/A",
        productNames || "N/A",
        quantities || "0",
        colors || "N/A",
        `৳${(order.total || 0).toFixed(2)}`,
      ]);

      itemsCount += (order.orderItems || []).reduce(
        (sum, item) => sum + Number(item?.quantity || 0),
        0
      );
    });

    // Export to Google Sheets
    const initialized = await googleSheetsService.initialize();
    if (!initialized) {
      return res.status(500).json({
        success: false,
        message: "Google Sheets API is not configured",
      });
    }

    const result = await googleSheetsService.appendToSheet(
      "Orders Export",
      exportHeaders,
      exportRows
    );

    // Mark all exported orders as synced
    const orderIds = orders.map((order) => order._id);
    await Order.updateMany(
      { _id: { $in: orderIds } },
      { $set: { syncedToSheet: true, syncedAt: new Date() } }
    );

    res.status(200).json({
      success: true,
      message: `Successfully exported ${orders.length} orders to Google Sheets`,
      ordersCount: orders.length,
      itemsCount,
      sheetUrl: result.sheetUrl,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Track order by ID (with optional phone verification)
// @route   GET /api/orders/track/:orderId
// @access  Public
exports.trackOrder = async (req, res, next) => {
  try {
    console.log('[TRACK_ORDER_START]', {
      timestamp: new Date().toISOString(),
      orderId: req.params.orderId,
      phone: req.query.phone,
    });

    // Tracking must always be fresh; avoid browser/proxy/CDN caching.
    res.set("Cache-Control", "no-store, max-age=0");
    res.set("Pragma", "no-cache");

    const { orderId } = req.params;
    const { phone } = req.query;

    let order = null;

    const extractOrderNumber = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return null;

      // If pure digits (and not a typical BD phone), treat as invoice/order number.
      if (/^\d+$/.test(raw)) {
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : null;
      }

      // Handles formats like DW-INV-10234, INV-10234, #10234, etc.
      const m = raw.match(/(\d{3,})\s*$/);
      if (!m) return null;
      const n = Number(m[1]);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(String(orderId || "").trim());
    const normalizedOrderId = String(orderId || "").trim();
    const shortIdPattern = /^[0-9a-fA-F]{8}$/.test(normalizedOrderId)
      ? normalizedOrderId.toUpperCase()
      : "";

    // If orderId is a numeric order number, try direct lookup
    const numericOrderNumber = Number(normalizedOrderId);
    if (!Number.isNaN(numericOrderNumber) && numericOrderNumber > 0) {
      order = await Order.findOne({ orderNumber: numericOrderNumber }).populate(
        "orderItems.product",
        "name images"
      );
    }

    // If orderId contains an invoice-like number (e.g., DW-INV-10234)
    if (!order) {
      const extracted = extractOrderNumber(normalizedOrderId);
      if (extracted) {
        order = await Order.findOne({ orderNumber: extracted }).populate(
          "orderItems.product",
          "name images"
        );
      }
    }

    if (!order && isValidObjectId) {
      // Try to find order by full ID
      try {
        order = await Order.findById(normalizedOrderId).populate(
          "orderItems.product",
          "name images"
        );
      } catch (err) {
        // If findById fails, order will remain null
      }
    }

    if (!order) {
      // Try to find by last 8 characters of ObjectId (tracking code)
      if (shortIdPattern) {
        // Fast path for newer orders with cached shortId
        order = await Order.findOne({ shortId: shortIdPattern }).populate(
          "orderItems.product",
          "name images"
        );

        // Fallback for legacy orders without shortId (server-side scan in MongoDB)
        if (!order) {
          const match = await Order.aggregate([
            {
              $match: {
                $expr: {
                  $eq: [
                    {
                      $toUpper: {
                        $substrBytes: [{ $toString: "$_id" }, 16, 8],
                      },
                    },
                    shortIdPattern,
                  ],
                },
              },
            },
            { $project: { _id: 1 } },
            { $limit: 1 },
          ]);

          if (match && match.length > 0) {
            order = await Order.findById(match[0]._id).populate(
              "orderItems.product",
              "name images"
            );
          }
        }
      }
    }

    if (!order) {
      console.log('[TRACK_ORDER_NOT_FOUND]', {
        timestamp: new Date().toISOString(),
        orderId: req.params.orderId,
        phone: req.query.phone,
        searched: {
          isValidObjectId,
          normalizedOrderId,
          shortIdPattern,
          numericOrderNumber,
        },
      });

      return res.status(404).json({
        success: false,
        message: "Order not found. Please check your Order ID and try again.",
      });
    }

    console.log('[TRACK_ORDER_FOUND]', {
      timestamp: new Date().toISOString(),
      orderId: req.params.orderId,
      foundOrderId: order._id?.toString(),
      orderNumber: order.orderNumber,
      isGuestOrder: order.isGuestOrder,
    });

    // Optional phone verification for guest orders
    if (phone && order.isGuestOrder) {
      const orderPhone =
        order.guestInfo?.phone || order.shippingAddress?.phone || "";

      const normalizeForCompare = (value) => {
        const digits = String(value || "").replace(/[^\d]/g, "");
        if (!digits) return "";

        // Bangladesh canonicalization: +8801XXXXXXXXX / 8801XXXXXXXXX -> 01XXXXXXXXX
        if (digits.startsWith("8801") && digits.length === 13) {
          return `0${digits.slice(3)}`;
        }

        // Keep local 01XXXXXXXXX as-is when possible
        if (digits.startsWith("01") && digits.length === 11) {
          return digits;
        }

        return digits;
      };

      const normalizedPhone = normalizeForCompare(phone);
      const normalizedOrderPhone = normalizeForCompare(orderPhone);

      if (!normalizedPhone || normalizedPhone !== normalizedOrderPhone) {
        return res.status(403).json({
          success: false,
          message: "Phone number does not match order records.",
        });
      }
    }

    const trackingData = buildTrackingData(order);

    res.status(200).json({
      success: true,
      data: trackingData,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Track order via flexible search (Order ID / Invoice ID / Phone)
// @route   POST /api/orders/track-search
// @access  Public
exports.trackOrderSearch = async (req, res, next) => {
  try {
    // Tracking must always be fresh; avoid browser/proxy/CDN caching.
    res.set("Cache-Control", "no-store, max-age=0");
    res.set("Pragma", "no-cache");

    const rawQuery = String(req.body?.query || "").trim();

    if (!rawQuery) {
      return res.status(400).json({
        success: false,
        message: "Please enter an Order ID, Invoice ID, or Phone Number.",
      });
    }

    const normalizedPhone = normalizePhone(rawQuery);

    const buildPhoneCandidates = (value) => {
      const raw = String(value || "").trim();
      const digits = raw.replace(/[^\d]/g, "");
      const candidates = new Set();

      if (raw) candidates.add(raw);
      if (digits) candidates.add(digits);

      // Normalize to local format if possible
      const local = normalizePhone(raw);
      if (local) candidates.add(local);

      // Also add E.164-ish variants for BD numbers to match legacy stored formats
      // local: 01XXXXXXXXX -> e164 digits: 8801XXXXXXXXX
      if (/^01[3-9]\d{8}$/.test(local)) {
        const e164Digits = `880${local.slice(1)}`;
        candidates.add(e164Digits);
        candidates.add(`+${e164Digits}`);
      }

      // If input already looks like 8801XXXXXXXXX, add local variants too
      if (/^8801[3-9]\d{8}$/.test(digits)) {
        const localFromE164 = `0${digits.slice(3)}`;
        candidates.add(localFromE164);
      }

      return Array.from(candidates).filter(Boolean);
    };

    const extractOrderNumber = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return null;
      if (/^\d+$/.test(raw)) {
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : null;
      }
      const m = raw.match(/(\d{3,})\s*$/);
      if (!m) return null;
      const n = Number(m[1]);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const isObjectId = /^[0-9a-fA-F]{24}$/.test(rawQuery);
    const shortIdPattern = /^[0-9a-fA-F]{8}$/.test(rawQuery)
      ? rawQuery.toUpperCase()
      : "";

    // 1) Phone search (most common for guests)
    if (isValidBdPhone(rawQuery) || (normalizedPhone && isValidBdPhone(normalizedPhone))) {
      const phoneCandidates = buildPhoneCandidates(rawQuery);

      const phoneMaxResultsRaw = parseIntEnv("TRACK_PHONE_MAX_RESULTS", 10);
      const phoneMaxResults = Math.min(50, Math.max(1, phoneMaxResultsRaw));

      const orders = await Order.find({
        $or: [
          { "shippingAddress.phone": { $in: phoneCandidates } },
          { "guestInfo.phone": { $in: phoneCandidates } },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(phoneMaxResults)
        .populate("orderItems.product", "name images")
        .select("-__v");

      if (!orders || orders.length === 0) {
        return res.status(404).json({
          success: false,
          message:
            "No website orders found for this phone number. If the order exists only in Pathao Merchant (created manually/outside the website), it won’t appear here.",
        });
      }

      const results = orders.map((o) => buildTrackingData(o));

      return res.status(200).json({
        success: true,
        data: {
          searchType: "phone",
          query: normalizedPhone || rawQuery,
          count: results.length,
          orders: results,
        },
      });
    }

    // 2) Invoice/Order number search
    const orderNumber = extractOrderNumber(rawQuery);
    if (orderNumber) {
      const order = await Order.findOne({ orderNumber })
        .populate("orderItems.product", "name images")
        .select("-__v");

      if (order) {
        const data = buildTrackingData(order);
        return res.status(200).json({
          success: true,
          data,
        });
      }
    }

    // 3) Full Mongo ObjectId
    if (isObjectId) {
      const order = await Order.findById(rawQuery)
        .populate("orderItems.product", "name images")
        .select("-__v");

      if (order) {
        const data = buildTrackingData(order);
        return res.status(200).json({
          success: true,
          data,
        });
      }
    }

    // 4) Last-8 tracking code
    if (shortIdPattern) {
      let order = await Order.findOne({ shortId: shortIdPattern })
        .populate("orderItems.product", "name images")
        .select("-__v");

      if (!order) {
        const match = await Order.aggregate([
          {
            $match: {
              $expr: {
                $eq: [
                  {
                    $toUpper: {
                      $substrBytes: [{ $toString: "$_id" }, 16, 8],
                    },
                  },
                  shortIdPattern,
                ],
              },
            },
          },
          { $project: { _id: 1 } },
          { $limit: 1 },
        ]);

        if (match && match.length > 0) {
          order = await Order.findById(match[0]._id)
            .populate("orderItems.product", "name images")
            .select("-__v");
        }
      }

      if (order) {
        const data = buildTrackingData(order);
        return res.status(200).json({
          success: true,
          data,
        });
      }
    }

    return res.status(404).json({
      success: false,
      message:
        "Order not found. Please check your Order ID/Invoice ID or phone number and try again.",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update order details (shipping address, notes)
// @route   PUT /api/orders/:id
// @access  Private/Admin
exports.updateOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const { shippingAddress, notes } = req.body;

    // Update shipping address if provided
    if (shippingAddress) {
      order.shippingAddress = {
        ...order.shippingAddress,
        ...shippingAddress,
      };
    }

    // Update notes if provided
    if (notes !== undefined) {
      order.notes = notes;
    }

    const updatedOrder = await order.save();

    res.status(200).json({
      success: true,
      message: "Order updated successfully",
      order: updatedOrder,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update advance payment details for an order
// @route   PUT /api/orders/:id/advance-payment
// @access  Private/Admin
exports.updateAdvancePayment = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const advancePayload = req.body.advancePayment || {};
    const {
      paymentMethod,
      senderNumber,
      transactionId,
      amount,
      status,
      rejectedReason,
    } = advancePayload;

    const advanceMethods = ["bkash", "nagad", "rocket", "upay"];

    if (paymentMethod !== undefined) {
      const method = String(paymentMethod || "").trim().toLowerCase();
      if (method && !advanceMethods.includes(method)) {
        return res.status(400).json({ success: false, message: "Invalid advance payment method" });
      }
      order.advancePayment.paymentMethod = method;
    }

    if (senderNumber !== undefined) {
      const normalizedSender = normalizePhone(senderNumber);
      if (!isValidBdPhone(normalizedSender)) {
        return res.status(400).json({ success: false, message: "Sender mobile must be a valid Bangladesh number" });
      }
      order.advancePayment.senderNumber = normalizedSender;
    }

    if (transactionId !== undefined) {
      const txId = String(transactionId || "").trim();
      order.advancePayment.transactionId = txId;
      order.advancePayment.last4 = txId.slice(-4);
    }

    if (amount !== undefined) {
      const paid = Number(amount);
      if (!Number.isFinite(paid) || paid < 0) {
        return res.status(400).json({ success: false, message: "Paid amount must be a valid number" });
      }
      order.advancePayment.amount = paid;
      order.advancePaid = paid;
      order.dueAmount = Math.max(Number(order.total || 0) - paid, 0);
    }

    if (status !== undefined) {
      const normalizedStatus = String(status || "").trim();
      const validStatuses = ["Pending", "Verified", "Rejected", "None"];
      if (normalizedStatus && !validStatuses.includes(normalizedStatus)) {
        return res.status(400).json({ success: false, message: "Invalid advance payment status" });
      }
      order.advancePaymentStatus = normalizedStatus || order.advancePaymentStatus;

      if (normalizedStatus === "Verified") {
        order.advancePaymentRequired = false;
        order.paymentStatus = "paid";
        if (!order.paidAt) order.paidAt = new Date();
        if (!order.advancePayment.paidAt) order.advancePayment.paidAt = new Date();
      }

      if (normalizedStatus === "Pending") {
        order.advancePaymentRequired = true;
      }

      if (normalizedStatus === "Rejected") {
        order.advancePaymentRequired = true;
      }
    }

    if (rejectedReason !== undefined) {
      order.advancePayment.rejectedReason = String(rejectedReason || "").trim();
    }

    const updatedOrder = await order.save();

    res.status(200).json({ success: true, message: "Advance payment updated successfully", order: updatedOrder });
  } catch (error) {
    next(error);
  }
};

// @desc    Update order items (name/price/quantity) and recompute totals
// @route   PUT /api/orders/:id/items
// @access  Private/Admin
exports.updateOrderItems = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const payloadItems = Array.isArray(req.body?.orderItems) ? req.body.orderItems : null;
    if (!payloadItems || payloadItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "orderItems array is required",
      });
    }

    const currentItems = Array.isArray(order.orderItems) ? order.orderItems : [];
    if (currentItems.length !== payloadItems.length) {
      return res.status(400).json({
        success: false,
        message: "orderItems length mismatch",
      });
    }

    const previousPricing = {
      subtotal: roundCurrency(order.subtotal),
      discount: roundCurrency(order.discount),
      deliveryFee: roundCurrency(order.deliveryFee),
      total: roundCurrency(order.total),
    };

    const updatedItems = payloadItems.map((incoming, idx) => {
      const existing = currentItems[idx];
      const name = String(incoming?.name ?? existing?.name ?? "").trim();
      const price = Number(incoming?.price ?? existing?.price ?? 0);
      const quantityRaw = incoming?.quantity ?? existing?.quantity ?? 0;
      const quantity = Number.parseInt(quantityRaw, 10);

      if (!name) {
        throw new Error("Each item must have a name");
      }
      if (!Number.isFinite(price) || price < 0) {
        throw new Error("Each item must have a valid price");
      }
      if (!Number.isFinite(quantity) || quantity < 1) {
        throw new Error("Each item must have a valid quantity");
      }

      return {
        product: existing?.product,
        name,
        image: incoming?.image ?? existing?.image,
        quantity,
        size: incoming?.size ?? existing?.size,
        color: incoming?.color ?? existing?.color,
        price,
      };
    });

    const itemsSubtotal = updatedItems.reduce(
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
      0
    );

    order.orderItems = updatedItems;
    // When admin edits items, treat the order as "no discount" unless pricing is adjusted separately.
    order.subtotal = roundCurrency(itemsSubtotal);
    order.discount = 0;
    order.total = roundCurrency(itemsSubtotal + Number(order.deliveryFee || 0));
    order.pricingVersion = Math.max(Number(order.pricingVersion || 1), 3);
    order.orderFingerprint = buildOrderFingerprint(updatedItems);

    order.pricingHistory = Array.isArray(order.pricingHistory) ? order.pricingHistory : [];
    order.pricingHistory.push({
      previous: previousPricing,
      next: {
        subtotal: roundCurrency(order.subtotal),
        discount: roundCurrency(order.discount),
        deliveryFee: roundCurrency(order.deliveryFee),
        total: roundCurrency(order.total),
      },
      reason: "Admin edited order items",
      updatedBy: req.user?._id || null,
      updatedAt: new Date(),
    });

    const saved = await order.save();

    await saved.populate("orderItems.product", "name images category");

    return res.status(200).json({
      success: true,
      message: "Order items updated",
      order: saved,
    });
  } catch (error) {
    // Convert expected validation to 400
    if (error && typeof error.message === "string" && error.message.startsWith("Each item")) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    if (error && typeof error.message === "string" && error.message.includes("length mismatch")) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

const roundCurrency = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
};

// @desc    Update order pricing (subtotal/discount/deliveryFee) with audit trail
// @route   PUT /api/orders/:id/pricing
// @access  Private/Admin
exports.updateOrderPricing = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const { subtotal, discount, deliveryFee, total, reason } = req.body || {};
    const trimmedReason = String(reason || "").trim();

    if (!trimmedReason || trimmedReason.length < 3) {
      return res.status(400).json({
        success: false,
        message: "A short reason is required to update pricing",
      });
    }

    const currentSubtotal = roundCurrency(order.subtotal);
    const currentDiscount = roundCurrency(order.discount);
    const currentDeliveryFee = roundCurrency(order.deliveryFee);

    const hasSubtotal = subtotal !== undefined && subtotal !== null && subtotal !== "";
    const hasDiscount = discount !== undefined && discount !== null && discount !== "";
    const hasDeliveryFee = deliveryFee !== undefined && deliveryFee !== null && deliveryFee !== "";
    const hasTotal = total !== undefined && total !== null && total !== "";

    let nextSubtotal = hasSubtotal ? roundCurrency(subtotal) : currentSubtotal;
    let nextDeliveryFee = hasDeliveryFee ? roundCurrency(deliveryFee) : currentDeliveryFee;

    if (nextSubtotal < 0 || nextDeliveryFee < 0) {
      return res.status(400).json({
        success: false,
        message: "Subtotal and delivery fee must be non-negative",
      });
    }

    let nextDiscount;
    if (hasDiscount) {
      nextDiscount = roundCurrency(discount);
    } else if (hasTotal) {
      const desiredTotal = roundCurrency(total);
      const derivedDiscount = nextSubtotal + nextDeliveryFee - desiredTotal;
      nextDiscount = roundCurrency(derivedDiscount);
    } else {
      nextDiscount = currentDiscount;
    }

    if (nextDiscount < 0) {
      return res.status(400).json({
        success: false,
        message: "Discount cannot be negative",
      });
    }

    if (nextDiscount > nextSubtotal) {
      return res.status(400).json({
        success: false,
        message: "Discount cannot exceed subtotal",
      });
    }

    const nextTotal = roundCurrency(nextSubtotal - nextDiscount + nextDeliveryFee);

    const changed =
      nextSubtotal !== currentSubtotal ||
      nextDiscount !== currentDiscount ||
      nextDeliveryFee !== currentDeliveryFee ||
      nextTotal !== roundCurrency(order.total);

    if (!changed) {
      return res.status(200).json({
        success: true,
        message: "No pricing changes detected",
        order,
      });
    }

    order.pricingHistory = Array.isArray(order.pricingHistory) ? order.pricingHistory : [];
    order.pricingHistory.push({
      previous: {
        subtotal: currentSubtotal,
        discount: currentDiscount,
        deliveryFee: currentDeliveryFee,
        total: roundCurrency(order.total),
      },
      next: {
        subtotal: nextSubtotal,
        discount: nextDiscount,
        deliveryFee: nextDeliveryFee,
        total: nextTotal,
      },
      reason: trimmedReason,
      updatedBy: req.user?._id || null,
      updatedAt: new Date(),
    });

    order.subtotal = nextSubtotal;
    order.discount = nextDiscount;
    order.deliveryFee = nextDeliveryFee;
    order.total = nextTotal;

    // Pricing changes should re-sync to sheets (if used)
    order.syncedToSheet = false;
    order.syncedAt = null;

    const updatedOrder = await order.save();

    return res.status(200).json({
      success: true,
      message: "Order pricing updated successfully",
      order: updatedOrder,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete order
// @route   DELETE /api/orders/:id
// @access  Private/Admin
exports.deleteOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    await order.deleteOne();

    res.status(200).json({
      success: true,
      message: "Order deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
