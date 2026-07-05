const webPushService = require("../services/webPush");
const Order = require("../models/Order");

const normalizeBdPhone = (value) => {
    const digits = String(value || "").replace(/[^\d]/g, "");
    if (!digits) return "";
    if (digits.startsWith("8801") && digits.length === 13) {
        return `0${digits.slice(3)}`;
    }
    return digits;
};

const isValidBdPhone = (value) => /^01[3-9]\d{8}$/.test(normalizeBdPhone(value));

const findOrderByTrackingId = async (raw) => {
    const normalized = String(raw || "").trim();
    if (!normalized) return null;

    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(normalized);
    const shortIdPattern = /^[0-9a-fA-F]{8}$/.test(normalized) ? normalized.toUpperCase() : "";

    if (/^\d+$/.test(normalized)) {
        const n = Number(normalized);
        if (Number.isFinite(n) && n > 0) {
            return Order.findOne({ orderNumber: n });
        }
    }

    if (isValidObjectId) {
        try {
            const byId = await Order.findById(normalized);
            if (byId) return byId;
        } catch {
            // ignore
        }
    }

    if (shortIdPattern) {
        const byShort = await Order.findOne({ shortId: shortIdPattern });
        if (byShort) return byShort;
    }

    return null;
};

// @desc    Get VAPID public key (safe to expose)
// @route   GET /api/push/public-key
// @access  Public
exports.getVapidPublicKey = async (req, res) => {
    const publicKey = webPushService.getPublicKey();
    if (!publicKey) {
        return res.status(503).json({
            success: false,
            message: "Push notifications are not configured",
        });
    }

    return res.status(200).json({
        success: true,
        publicKey,
    });
};

// @desc    Save/update an admin push subscription
// @route   POST /api/push/subscribe
// @access  Private/Admin
exports.subscribeAdmin = async (req, res, next) => {
    try {
        const subscription = req.body?.subscription;
        if (!subscription) {
            return res.status(400).json({
                success: false,
                message: "subscription is required",
            });
        }

        const saved = await webPushService.upsertAdminSubscription(subscription, {
            userAgent: req.get("user-agent") || "",
        });

        return res.status(200).json({
            success: true,
            subscription: saved,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Save/update a customer push subscription
// @route   POST /api/push/subscribe-user
// @access  Private
exports.subscribeUser = async (req, res, next) => {
    try {
        const subscription = req.body?.subscription;
        if (!subscription) {
            return res.status(400).json({
                success: false,
                message: "subscription is required",
            });
        }

        const saved = await webPushService.upsertUserSubscription(req.user._id, subscription, {
            userAgent: req.get("user-agent") || "",
        });

        return res.status(200).json({
            success: true,
            subscription: saved,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Remove a customer push subscription
// @route   POST /api/push/unsubscribe-user
// @access  Private
exports.unsubscribeUser = async (req, res, next) => {
    try {
        const endpoint = req.body?.endpoint;
        if (!endpoint) {
            return res.status(400).json({
                success: false,
                message: "endpoint is required",
            });
        }

        await webPushService.removeUserSubscriptionByEndpoint(req.user._id, endpoint);

        return res.status(200).json({
            success: true,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Remove an admin push subscription
// @route   POST /api/push/unsubscribe
// @access  Private/Admin
exports.unsubscribeAdmin = async (req, res, next) => {
    try {
        const endpoint = String(req.body?.endpoint || req.body?.subscription?.endpoint || "").trim();
        if (!endpoint) {
            return res.status(400).json({
                success: false,
                message: "endpoint is required",
            });
        }

        await webPushService.removeAdminSubscriptionByEndpoint(endpoint);

        return res.status(200).json({
            success: true,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Save/update a guest order push subscription (phone-verified)
// @route   POST /api/push/subscribe-guest
// @access  Public
exports.subscribeGuest = async (req, res, next) => {
    try {
        const orderId = req.body?.orderId;
        const phone = req.body?.phone;
        const subscription = req.body?.subscription;

        if (!orderId || !phone || !subscription) {
            return res.status(400).json({
                success: false,
                message: "orderId, phone, and subscription are required",
            });
        }

        const normalizedPhone = normalizeBdPhone(phone);
        if (!isValidBdPhone(normalizedPhone)) {
            return res.status(400).json({
                success: false,
                message: "Invalid phone number",
            });
        }

        const order = await findOrderByTrackingId(orderId);
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        if (!order.isGuestOrder) {
            return res.status(403).json({ success: false, message: "Not a guest order" });
        }

        const orderPhone = normalizeBdPhone(order?.guestInfo?.phone || order?.shippingAddress?.phone || "");
        if (!orderPhone || orderPhone !== normalizedPhone) {
            return res.status(403).json({ success: false, message: "Phone verification failed" });
        }

        const saved = await webPushService.upsertGuestOrderSubscription(order._id, subscription, {
            userAgent: req.get("user-agent") || "",
        });

        return res.status(200).json({
            success: true,
            subscription: saved,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Remove a guest order push subscription (phone-verified)
// @route   POST /api/push/unsubscribe-guest
// @access  Public
exports.unsubscribeGuest = async (req, res, next) => {
    try {
        const orderId = req.body?.orderId;
        const phone = req.body?.phone;
        const endpoint = req.body?.endpoint;

        if (!orderId || !phone || !endpoint) {
            return res.status(400).json({
                success: false,
                message: "orderId, phone, and endpoint are required",
            });
        }

        const normalizedPhone = normalizeBdPhone(phone);
        if (!isValidBdPhone(normalizedPhone)) {
            return res.status(400).json({
                success: false,
                message: "Invalid phone number",
            });
        }

        const order = await findOrderByTrackingId(orderId);
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        if (!order.isGuestOrder) {
            return res.status(403).json({ success: false, message: "Not a guest order" });
        }

        const orderPhone = normalizeBdPhone(order?.guestInfo?.phone || order?.shippingAddress?.phone || "");
        if (!orderPhone || orderPhone !== normalizedPhone) {
            return res.status(403).json({ success: false, message: "Phone verification failed" });
        }

        await webPushService.removeGuestOrderSubscriptionByEndpoint(order._id, endpoint);

        return res.status(200).json({ success: true });
    } catch (error) {
        next(error);
    }
};
