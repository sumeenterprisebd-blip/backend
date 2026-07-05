const rateLimit = require("express-rate-limit");

const parsePositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(String(value || ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// Targeted limiter for order creation to reduce spam/fake orders.
// Note: in serverless / multi-instance deployments, consider a shared store (e.g., Redis).
const orderCreateLimiter = rateLimit({
    windowMs: parsePositiveInt(process.env.ORDER_CREATE_RL_WINDOW_MS, 10 * 60 * 1000),
    max: parsePositiveInt(process.env.ORDER_CREATE_RL_MAX, 10),
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === "OPTIONS",
    keyGenerator: (req) => {
        const ip = req.ip || "";
        const userId = req.user?._id ? String(req.user._id) : "guest";
        return `${ip}:${userId}`;
    },
    handler: (req, res) => {
        res.status(429).json({
            success: false,
            message: "Too many order attempts. Please wait and try again.",
        });
    },
});

const advancePaymentLimiter = rateLimit({
    windowMs: parsePositiveInt(process.env.ADVANCE_PAYMENT_RL_WINDOW_MS, 15 * 60 * 1000),
    max: parsePositiveInt(process.env.ADVANCE_PAYMENT_RL_MAX, 20),
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === "OPTIONS",
    keyGenerator: (req) => {
        const ip = req.ip || "";
        const userId = req.user?._id ? String(req.user._id) : "guest";
        return `${ip}:${userId}:advance`;
    },
    handler: (req, res) => {
        res.status(429).json({
            success: false,
            message: "Too many advance payment attempts. Please wait and try again.",
        });
    },
});

// Targeted limiter for search & suggestions to protect against scraping and expensive queries.
// Note: in serverless / multi-instance deployments, consider a shared store (e.g., Redis).
const searchLimiter = rateLimit({
    windowMs: parsePositiveInt(process.env.SEARCH_RL_WINDOW_MS, 60 * 1000),
    max: parsePositiveInt(process.env.SEARCH_RL_MAX, 120),
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === "OPTIONS",
    keyGenerator: (req) => {
        const ip = req.ip || "";
        return `${ip}:search`;
    },
    handler: (req, res) => {
        res.status(429).json({
            success: false,
            message: "Too many search requests. Please wait and try again.",
        });
    },
});

module.exports = {
    orderCreateLimiter,
    advancePaymentLimiter,
    searchLimiter,
};
