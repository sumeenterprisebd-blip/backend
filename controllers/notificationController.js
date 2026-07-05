const Notification = require("../models/Notification");
const Order = require("../models/Order");

const normalizeBdPhone = (value) => {
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

const isValidBdPhone = (value) => /^01[3-9]\d{8}$/.test(normalizeBdPhone(value));

const verifyGuestOrdersFromBody = async (rawOrders) => {
    const orders = Array.isArray(rawOrders) ? rawOrders : [];

    if (!orders.length) {
        const err = new Error("orders is required");
        err.statusCode = 400;
        throw err;
    }

    if (orders.length > 5) {
        const err = new Error("Too many orders (max 5)");
        err.statusCode = 400;
        throw err;
    }

    const verifiedPairs = [];

    for (const entry of orders) {
        const orderId = entry?.orderId;
        const phone = entry?.phone;
        const normalizedPhone = normalizeBdPhone(phone);

        if (!orderId || !normalizedPhone || !isValidBdPhone(normalizedPhone)) continue;

        const order = await findOrderByTrackingId(orderId);
        if (!order) continue;
        if (!order.isGuestOrder) continue;

        const orderPhone = normalizeBdPhone(order?.guestInfo?.phone || order?.shippingAddress?.phone || "");
        if (!orderPhone || orderPhone !== normalizedPhone) continue;

        verifiedPairs.push({
            guestPhone: normalizedPhone,
            order: order._id,
        });
    }

    const or = verifiedPairs.map((p) => ({ guestPhone: p.guestPhone, order: p.order }));
    return { verifiedPairs, or };
};

const findOrderByTrackingId = async (raw) => {
    const normalized = String(raw || "").trim();
    if (!normalized) return null;

    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(normalized);
    const shortIdPattern = /^[0-9a-fA-F]{8}$/.test(normalized) ? normalized.toUpperCase() : "";

    // numeric order number
    if (/^\d+$/.test(normalized)) {
        const n = Number(normalized);
        if (Number.isFinite(n) && n > 0) {
            return Order.findOne({ orderNumber: n });
        }
    }

    // invoice-like string ending with digits
    const m = normalized.match(/(\d{3,})\s*$/);
    if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > 0) {
            const byNumber = await Order.findOne({ orderNumber: n });
            if (byNumber) return byNumber;
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

// @desc    List notifications for the logged-in user
// @route   GET /api/notifications
// @access  Private
exports.getMyNotifications = async (req, res, next) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 50);
        const page = Math.max(Number(req.query.page || 1), 1);
        const unreadOnly = String(req.query.unreadOnly || "").toLowerCase() === "true";

        const query = { user: req.user._id };
        if (unreadOnly) query.isRead = false;

        const [items, total] = await Promise.all([
            Notification.find(query)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            Notification.countDocuments(query),
        ]);

        return res.status(200).json({
            success: true,
            notifications: items,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get unread notification count
// @route   GET /api/notifications/unread-count
// @access  Private
exports.getMyUnreadCount = async (req, res, next) => {
    try {
        const count = await Notification.countDocuments({
            user: req.user._id,
            isRead: false,
        });

        return res.status(200).json({
            success: true,
            unreadCount: count,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Mark a notification as read
// @route   PATCH /api/notifications/:id/read
// @access  Private
exports.markMyNotificationRead = async (req, res, next) => {
    try {
        const notification = await Notification.findOne({
            _id: req.params.id,
            user: req.user._id,
        });

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: "Notification not found",
            });
        }

        if (!notification.isRead) {
            notification.isRead = true;
            notification.readAt = new Date();
            await notification.save();
        }

        return res.status(200).json({
            success: true,
            notification,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Mark all notifications as read
// @route   PATCH /api/notifications/read-all
// @access  Private
exports.markAllMyNotificationsRead = async (req, res, next) => {
    try {
        const now = new Date();

        const result = await Notification.updateMany(
            { user: req.user._id, isRead: false },
            { $set: { isRead: true, readAt: now } }
        );

        return res.status(200).json({
            success: true,
            modifiedCount: result.modifiedCount ?? result.nModified ?? 0,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    List notifications for a guest order (phone-verified)
// @route   POST /api/notifications/guest
// @access  Public
exports.getGuestNotifications = async (req, res, next) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 50);

        const { verifiedPairs, or } = await verifyGuestOrdersFromBody(req.body?.orders);

        if (verifiedPairs.length === 0) {
            return res.status(200).json({
                success: true,
                notifications: [],
            });
        }

        const items = await Notification.find({ $or: or })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        return res.status(200).json({
            success: true,
            notifications: items,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get unread count for guest notifications (phone-verified)
// @route   POST /api/notifications/guest/unread-count
// @access  Public
exports.getGuestUnreadCount = async (req, res, next) => {
    try {
        const { verifiedPairs, or } = await verifyGuestOrdersFromBody(req.body?.orders);

        if (verifiedPairs.length === 0) {
            return res.status(200).json({
                success: true,
                unreadCount: 0,
            });
        }

        const unreadCount = await Notification.countDocuments({ $or: or, isRead: false });

        return res.status(200).json({
            success: true,
            unreadCount,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Mark a single guest notification as read (phone-verified)
// @route   PATCH /api/notifications/guest/:id/read
// @access  Public
exports.markGuestNotificationRead = async (req, res, next) => {
    try {
        const notificationId = String(req.params?.id || "").trim();
        if (!notificationId) {
            return res.status(400).json({ success: false, message: "Invalid notification id" });
        }

        const { verifiedPairs, or } = await verifyGuestOrdersFromBody(req.body?.orders);
        if (verifiedPairs.length === 0) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        const now = new Date();

        const result = await Notification.updateOne(
            { _id: notificationId, $or: or, isRead: false },
            { $set: { isRead: true, readAt: now } }
        );

        const modified = Number(result?.modifiedCount ?? result?.nModified ?? 0);
        if (modified === 0) {
            // Either already read, not found, or doesn't belong to the verified guest order(s)
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        next(error);
    }
};

// @desc    Mark all guest notifications as read (phone-verified)
// @route   PATCH /api/notifications/guest/read-all
// @access  Public
exports.markAllGuestNotificationsRead = async (req, res, next) => {
    try {
        const { verifiedPairs, or } = await verifyGuestOrdersFromBody(req.body?.orders);
        if (verifiedPairs.length === 0) {
            return res.status(200).json({ success: true, modifiedCount: 0 });
        }

        const now = new Date();
        const result = await Notification.updateMany(
            { $or: or, isRead: false },
            { $set: { isRead: true, readAt: now } }
        );

        return res.status(200).json({
            success: true,
            modifiedCount: result.modifiedCount ?? result.nModified ?? 0,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    List admin notifications
// @route   GET /api/admin/notifications
// @access  Private/Admin
exports.getAdminNotifications = async (req, res, next) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
        const page = Math.max(Number(req.query.page || 1), 1);
        const type = String(req.query.type || "").trim().toLowerCase();
        const readFilter = req.query.isRead;

        const query = { recipientType: "admin" };
        if (type) query.type = type;
        if (readFilter !== undefined) {
            query.isRead = String(readFilter).toLowerCase() === "true";
        }

        const [items, total] = await Promise.all([
            Notification.find(query)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            Notification.countDocuments(query),
        ]);

        return res.status(200).json({
            success: true,
            notifications: items,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get admin unread notification count
// @route   GET /api/admin/notifications/unread-count
// @access  Private/Admin
exports.getAdminUnreadCount = async (req, res, next) => {
    try {
        const count = await Notification.countDocuments({ recipientType: "admin", isRead: false });
        return res.status(200).json({ success: true, unreadCount: count });
    } catch (error) {
        next(error);
    }
};

// @desc    Mark admin notification as read
// @route   PATCH /api/admin/notifications/:id/read
// @access  Private/Admin
exports.markAdminNotificationRead = async (req, res, next) => {
    try {
        const notification = await Notification.findOne({ _id: req.params.id, recipientType: "admin" });
        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }
        if (!notification.isRead) {
            notification.isRead = true;
            notification.readAt = new Date();
            await notification.save();
        }
        return res.status(200).json({ success: true, notification });
    } catch (error) {
        next(error);
    }
};

// @desc    Mark admin notification as unread
// @route   PATCH /api/admin/notifications/:id/unread
// @access  Private/Admin
exports.markAdminNotificationUnread = async (req, res, next) => {
    try {
        const notification = await Notification.findOne({ _id: req.params.id, recipientType: "admin" });
        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }
        if (notification.isRead) {
            notification.isRead = false;
            notification.readAt = null;
            await notification.save();
        }
        return res.status(200).json({ success: true, notification });
    } catch (error) {
        next(error);
    }
};

// @desc    Mark all admin notifications as read
// @route   PATCH /api/admin/notifications/read-all
// @access  Private/Admin
exports.markAllAdminNotificationsRead = async (req, res, next) => {
    try {
        const now = new Date();
        const result = await Notification.updateMany(
            { recipientType: "admin", isRead: false },
            { $set: { isRead: true, readAt: now } }
        );
        return res.status(200).json({ success: true, modifiedCount: result.modifiedCount ?? result.nModified ?? 0 });
    } catch (error) {
        next(error);
    }
};

// @desc    Delete admin notification
// @route   DELETE /api/admin/notifications/:id
// @access  Private/Admin
exports.deleteAdminNotification = async (req, res, next) => {
    try {
        const result = await Notification.deleteOne({ _id: req.params.id, recipientType: "admin" });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }
        return res.status(200).json({ success: true, message: "Notification deleted" });
    } catch (error) {
        next(error);
    }
};
