const webpush = require("web-push");
const Settings = require("../models/Settings");
const User = require("../models/User");
const Order = require("../models/Order");

let isConfigured = false;

const getVapidConfig = () => {
    const publicKey = String(process.env.VAPID_PUBLIC_KEY || "").trim();
    const privateKey = String(process.env.VAPID_PRIVATE_KEY || "").trim();
    const subject = String(process.env.VAPID_SUBJECT || "mailto:admin@deshwear.shop").trim();

    return { publicKey, privateKey, subject };
};

const ensureConfigured = () => {
    if (isConfigured) return;

    const { publicKey, privateKey, subject } = getVapidConfig();
    if (!publicKey || !privateKey) {
        throw new Error("Missing VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY env vars");
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    isConfigured = true;
};

const normalizeSubscription = (subscription) => {
    if (!subscription || typeof subscription !== "object") return null;
    const endpoint = String(subscription.endpoint || "").trim();
    const keys = subscription.keys || {};
    const p256dh = String(keys.p256dh || "").trim();
    const auth = String(keys.auth || "").trim();
    const expirationTime =
        subscription.expirationTime === undefined || subscription.expirationTime === null
            ? null
            : Number(subscription.expirationTime);

    if (!endpoint || !p256dh || !auth) return null;

    return {
        endpoint,
        expirationTime: Number.isFinite(expirationTime) ? expirationTime : null,
        keys: { p256dh, auth },
    };
};

exports.getPublicKey = () => {
    const { publicKey } = getVapidConfig();
    return publicKey;
};

exports.upsertAdminSubscription = async (subscription, { userAgent = "" } = {}) => {
    const normalized = normalizeSubscription(subscription);
    if (!normalized) {
        const err = new Error("Invalid push subscription");
        err.statusCode = 400;
        throw err;
    }

    const settings = await Settings.getSettings();
    const list = Array.isArray(settings.adminPushSubscriptions)
        ? settings.adminPushSubscriptions
        : [];

    const now = new Date();
    const idx = list.findIndex((s) => String(s.endpoint || "") === normalized.endpoint);

    if (idx >= 0) {
        list[idx].keys = normalized.keys;
        list[idx].expirationTime = normalized.expirationTime;
        list[idx].userAgent = String(userAgent || list[idx].userAgent || "");
        list[idx].lastUsedAt = now;
    } else {
        list.push({
            ...normalized,
            userAgent: String(userAgent || ""),
            createdAt: now,
            lastUsedAt: now,
        });
    }

    settings.adminPushSubscriptions = list;
    await settings.save();

    return normalized;
};

exports.removeAdminSubscriptionByEndpoint = async (endpoint) => {
    const normalizedEndpoint = String(endpoint || "").trim();
    if (!normalizedEndpoint) return;

    const settings = await Settings.getSettings();
    const list = Array.isArray(settings.adminPushSubscriptions)
        ? settings.adminPushSubscriptions
        : [];

    const nextList = list.filter((s) => String(s.endpoint || "") !== normalizedEndpoint);
    settings.adminPushSubscriptions = nextList;
    await settings.save();
};

const buildOrderNotificationPayload = (order) => {
    const orderNumber = order?.orderNumber ? `#${order.orderNumber}` : "";
    const customerName = [order?.shippingAddress?.firstName, order?.shippingAddress?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
    const total = typeof order?.total === "number" ? order.total : Number(order?.total || 0);
    const bodyParts = ["New order", orderNumber, customerName].filter(Boolean);
    const body = bodyParts.join(" · ") + (Number.isFinite(total) && total > 0 ? ` · ৳${total}` : "");

    return {
        title: "New Order Placed",
        body,
        url: `/admin/orders?orderId=${encodeURIComponent(String(order?._id || ""))}`,
        tag: order?._id ? `order-${String(order._id)}` : "new-order",
        data: {
            url: `/admin/orders?orderId=${encodeURIComponent(String(order?._id || ""))}`,
            orderId: String(order?._id || ""),
            orderNumber: order?.orderNumber || null,
        },
    };
};

exports.notifyAdminNewOrder = async (order) => {
    ensureConfigured();

    const settings = await Settings.getSettings();
    const subs = Array.isArray(settings.adminPushSubscriptions)
        ? settings.adminPushSubscriptions
        : [];
    if (subs.length === 0) return { sent: 0, removed: 0 };

    const payload = buildOrderNotificationPayload(order);
    const jsonPayload = JSON.stringify(payload);
    const now = new Date();
    let removed = 0;
    let sent = 0;

    const alive = [];

    for (const sub of subs) {
        try {
            // 'sub' might be a mongoose subdocument; web-push accepts plain objects.
            await webpush.sendNotification(
                {
                    endpoint: sub.endpoint,
                    expirationTime: sub.expirationTime ?? null,
                    keys: {
                        p256dh: sub?.keys?.p256dh,
                        auth: sub?.keys?.auth,
                    },
                },
                jsonPayload,
                {
                    TTL: 60 * 15, // 15 minutes
                    urgency: "high",
                }
            );
            sent += 1;
            try {
                // Keep existing subdoc but update lastUsedAt when possible
                sub.lastUsedAt = now;
            } catch {
                // ignore
            }
            alive.push(sub);
        } catch (err) {
            const status = err?.statusCode || err?.status || 0;

            // Subscription is no longer valid
            if (status === 404 || status === 410) {
                removed += 1;
                continue;
            }

            // Keep subscription but don't fail the whole loop
            alive.push(sub);
        }
    }

    // Persist cleanup + lastUsedAt updates best-effort
    try {
        settings.adminPushSubscriptions = alive;
        await settings.save();
    } catch {
        // ignore
    }

    return { sent, removed };
};

exports.upsertUserSubscription = async (userId, subscription, { userAgent = "" } = {}) => {
    const normalized = normalizeSubscription(subscription);
    if (!normalized) {
        const err = new Error("Invalid push subscription");
        err.statusCode = 400;
        throw err;
    }

    const user = await User.findById(userId);
    if (!user) {
        const err = new Error("User not found");
        err.statusCode = 404;
        throw err;
    }

    const list = Array.isArray(user.pushSubscriptions) ? user.pushSubscriptions : [];
    const now = new Date();
    const idx = list.findIndex((s) => String(s.endpoint || "") === normalized.endpoint);

    if (idx >= 0) {
        list[idx].keys = normalized.keys;
        list[idx].expirationTime = normalized.expirationTime;
        list[idx].userAgent = String(userAgent || list[idx].userAgent || "");
        list[idx].lastUsedAt = now;
    } else {
        list.push({
            ...normalized,
            userAgent: String(userAgent || ""),
            createdAt: now,
            lastUsedAt: now,
        });
    }

    user.pushSubscriptions = list;
    await user.save();

    return normalized;
};

exports.removeUserSubscriptionByEndpoint = async (userId, endpoint) => {
    const normalizedEndpoint = String(endpoint || "").trim();
    if (!normalizedEndpoint) return;

    const user = await User.findById(userId);
    if (!user) return;

    const list = Array.isArray(user.pushSubscriptions) ? user.pushSubscriptions : [];
    user.pushSubscriptions = list.filter((s) => String(s.endpoint || "") !== normalizedEndpoint);
    await user.save();
};

exports.upsertGuestOrderSubscription = async (orderId, subscription, { userAgent = "" } = {}) => {
    const normalized = normalizeSubscription(subscription);
    if (!normalized) {
        const err = new Error("Invalid push subscription");
        err.statusCode = 400;
        throw err;
    }

    const order = await Order.findById(orderId);
    if (!order) {
        const err = new Error("Order not found");
        err.statusCode = 404;
        throw err;
    }

    const list = Array.isArray(order.guestPushSubscriptions) ? order.guestPushSubscriptions : [];
    const now = new Date();
    const idx = list.findIndex((s) => String(s.endpoint || "") === normalized.endpoint);

    if (idx >= 0) {
        list[idx].keys = normalized.keys;
        list[idx].expirationTime = normalized.expirationTime;
        list[idx].userAgent = String(userAgent || list[idx].userAgent || "");
        list[idx].lastUsedAt = now;
    } else {
        list.push({
            ...normalized,
            userAgent: String(userAgent || ""),
            createdAt: now,
            lastUsedAt: now,
        });
    }

    order.guestPushSubscriptions = list;
    await order.save();

    return normalized;
};

exports.removeGuestOrderSubscriptionByEndpoint = async (orderId, endpoint) => {
    const normalizedEndpoint = String(endpoint || "").trim();
    if (!normalizedEndpoint) return;

    const order = await Order.findById(orderId);
    if (!order) return;

    const list = Array.isArray(order.guestPushSubscriptions) ? order.guestPushSubscriptions : [];
    order.guestPushSubscriptions = list.filter((s) => String(s.endpoint || "") !== normalizedEndpoint);
    await order.save();
};

const buildGuestOrderStatusPayload = ({ order, nextStatus, message }) => {
    const orderNumber = order?.orderNumber ? `#${order.orderNumber}` : "";
    const status = String(nextStatus || "").toLowerCase();
    const body = [orderNumber, message].filter(Boolean).join(" · ");
    const trackingId = order?.orderNumber || order?.shortId || order?._id;
    const url = trackingId
        ? `/orders/track?id=${encodeURIComponent(String(trackingId))}`
        : "/orders/track";

    return {
        title: "Order Update",
        body,
        url,
        tag: order?._id ? `guest-order-${String(order._id)}-${status}` : "guest-order-update",
        data: {
            url,
            orderId: String(order?._id || ""),
            orderNumber: order?.orderNumber || null,
            shortId: order?.shortId || "",
            status,
            guest: true,
        },
    };
};

exports.notifyGuestOrderStatus = async ({ order, nextStatus, message }) => {
    ensureConfigured();

    const orderId = String(order?._id || "").trim();
    if (!orderId) return { sent: 0, removed: 0 };

    const fresh = await Order.findById(orderId);
    if (!fresh) return { sent: 0, removed: 0 };

    const subs = Array.isArray(fresh.guestPushSubscriptions) ? fresh.guestPushSubscriptions : [];
    if (subs.length === 0) return { sent: 0, removed: 0 };

    const payload = buildGuestOrderStatusPayload({ order: fresh, nextStatus, message });
    const jsonPayload = JSON.stringify(payload);
    const now = new Date();

    let removed = 0;
    let sent = 0;
    const alive = [];

    for (const sub of subs) {
        try {
            await webpush.sendNotification(
                {
                    endpoint: sub.endpoint,
                    expirationTime: sub.expirationTime ?? null,
                    keys: {
                        p256dh: sub?.keys?.p256dh,
                        auth: sub?.keys?.auth,
                    },
                },
                jsonPayload,
                {
                    TTL: 60 * 30,
                    urgency: "high",
                }
            );
            sent += 1;
            try {
                sub.lastUsedAt = now;
            } catch {
                // ignore
            }
            alive.push(sub);
        } catch (err) {
            const status = err?.statusCode || err?.status || 0;
            if (status === 404 || status === 410) {
                removed += 1;
                continue;
            }
            alive.push(sub);
        }
    }

    try {
        fresh.guestPushSubscriptions = alive;
        await fresh.save();
    } catch {
        // ignore
    }

    return { sent, removed };
};

const buildUserOrderStatusPayload = ({ order, nextStatus, message }) => {
    const orderNumber = order?.orderNumber ? `#${order.orderNumber}` : "";
    const status = String(nextStatus || "").toLowerCase();
    const body = [orderNumber, message].filter(Boolean).join(" · ");
    const url = order?._id ? `/orders/${encodeURIComponent(String(order._id))}` : "/orders";

    return {
        title: "Order Update",
        body,
        url,
        tag: order?._id ? `order-${String(order._id)}-${status}` : "order-update",
        data: {
            url,
            orderId: String(order?._id || ""),
            orderNumber: order?.orderNumber || null,
            status,
        },
    };
};

exports.notifyUserOrderStatus = async ({ userId, order, nextStatus, message }) => {
    ensureConfigured();

    const user = await User.findById(userId);
    if (!user) return { sent: 0, removed: 0 };

    const subs = Array.isArray(user.pushSubscriptions) ? user.pushSubscriptions : [];
    if (subs.length === 0) return { sent: 0, removed: 0 };

    const payload = buildUserOrderStatusPayload({ order, nextStatus, message });
    const jsonPayload = JSON.stringify(payload);
    const now = new Date();

    let removed = 0;
    let sent = 0;
    const alive = [];

    for (const sub of subs) {
        try {
            await webpush.sendNotification(
                {
                    endpoint: sub.endpoint,
                    expirationTime: sub.expirationTime ?? null,
                    keys: {
                        p256dh: sub?.keys?.p256dh,
                        auth: sub?.keys?.auth,
                    },
                },
                jsonPayload,
                {
                    TTL: 60 * 30,
                    urgency: "high",
                }
            );
            sent += 1;
            try {
                sub.lastUsedAt = now;
            } catch {
                // ignore
            }
            alive.push(sub);
        } catch (err) {
            const status = err?.statusCode || err?.status || 0;
            if (status === 404 || status === 410) {
                removed += 1;
                continue;
            }
            alive.push(sub);
        }
    }

    try {
        user.pushSubscriptions = alive;
        await user.save();
    } catch {
        // ignore
    }

    return { sent, removed };
};

