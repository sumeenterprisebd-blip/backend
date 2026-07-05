const Order = require("../models/Order");
const {
    validatePayment,
    getFrontendRedirectUrl,
} = require("../services/sslcommerzService");
const { sendMetaCapiPurchase } = require("../services/metaCapiService");

const pick = (obj, keys) => {
    const src = obj && typeof obj === "object" ? obj : {};
    const out = {};
    for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
    }
    return out;
};

const toMoney = (value) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
};

const isValidStatus = (s) => {
    const v = String(s || "").toUpperCase();
    return v === "VALID" || v === "VALIDATED";
};

const buildRedirectHtml = (redirectUrl, fallbackText) => {
    const safeUrl = String(redirectUrl || "");
    const text = String(fallbackText || "Redirecting...");
    if (!safeUrl) {
        return `<!doctype html><html><head><meta charset="utf-8" /><title>Payment</title></head><body><p>${text}</p></body></html>`;
    }

    return `<!doctype html><html><head><meta charset="utf-8" /><meta http-equiv="refresh" content="0;url=${safeUrl}" /><title>Payment</title></head><body><p>${text}</p><p><a href="${safeUrl}">Continue</a></p></body></html>`;
};

const findOrderByTranId = async (tranId) => {
    const tid = String(tranId || "").trim();
    if (!tid) return null;

    return Order.findOne({ "paymentDetails.tranId": tid });
};

const updateOrderPaymentFailure = async ({ order, payload, reason }) => {
    if (!order) return;

    order.paymentStatus = "failed";
    order.paymentDetails = {
        ...(order.paymentDetails || {}),
        provider: "sslcommerz",
        lastGatewayResponse: {
            type: "callback",
            reason: String(reason || ""),
            at: new Date().toISOString(),
            payload: pick(payload, [
                "status",
                "tran_id",
                "val_id",
                "amount",
                "currency",
                "bank_tran_id",
                "card_type",
                "error",
            ]),
        },
    };

    try {
        await order.save();
    } catch {
        // ignore
    }
};

// Gateway browser callbacks are usually POSTed as form data.
const readCallbackPayload = (req) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const query = req.query && typeof req.query === "object" ? req.query : {};
    return { ...query, ...body };
};

// @route POST /api/payments/sslcommerz/success
exports.success = async (req, res) => {
    const payload = readCallbackPayload(req);
    const tranId = payload.tran_id;
    const valId = payload.val_id;

    const order = await findOrderByTranId(tranId);

    if (!order) {
        const html = buildRedirectHtml(
            "",
            "Payment received but order was not found. Please contact support."
        );
        return res.status(404).send(html);
    }

    if (order.paymentStatus === "paid") {
        const redirectUrl = getFrontendRedirectUrl({ order, result: "success" });
        return res.status(200).send(buildRedirectHtml(redirectUrl, "Payment already confirmed. Redirecting..."));
    }

    if (!valId) {
        await updateOrderPaymentFailure({ order, payload, reason: "Missing val_id" });
        const redirectUrl = getFrontendRedirectUrl({ order, result: "failed" });
        return res.status(400).send(buildRedirectHtml(redirectUrl, "Payment verification failed. Redirecting..."));
    }

    try {
        const validation = await validatePayment({ valId });
        const statusOk = isValidStatus(validation?.status);

        const paidAmount = toMoney(validation?.amount);
        const expectedAmount = toMoney(order.total);
        const currency = String(validation?.currency_type || validation?.currency || "BDT");
        const currencyOk = currency.toUpperCase() === "BDT";

        const amountOk = Math.abs(paidAmount - expectedAmount) <= 0.5; // tolerate minor rounding

        const tranOk = String(validation?.tran_id || "") === String(tranId || "");

        if (!statusOk || !amountOk || !currencyOk || !tranOk) {
            await updateOrderPaymentFailure({
                order,
                payload,
                reason: "Validation mismatch",
            });

            order.paymentDetails = {
                ...(order.paymentDetails || {}),
                provider: "sslcommerz",
                tranId: String(tranId || ""),
                valId: String(validation?.val_id || valId || ""),
                bankTranId: String(validation?.bank_tran_id || ""),
                cardType: String(validation?.card_type || ""),
                amount: paidAmount,
                currency: currency,
                validatedAt: new Date(),
                lastGatewayResponse: {
                    type: "validation",
                    at: new Date().toISOString(),
                    validation,
                },
            };

            try {
                await order.save();
            } catch {
                // ignore
            }

            const redirectUrl = getFrontendRedirectUrl({ order, result: "failed" });
            return res.status(400).send(buildRedirectHtml(redirectUrl, "Payment verification failed. Redirecting..."));
        }

        order.paymentMethod = "sslcommerz";
        order.paymentStatus = "paid";
        order.paidAt = new Date();

        order.paymentDetails = {
            ...(order.paymentDetails || {}),
            provider: "sslcommerz",
            tranId: String(tranId || ""),
            valId: String(validation?.val_id || valId || ""),
            bankTranId: String(validation?.bank_tran_id || ""),
            cardType: String(validation?.card_type || ""),
            amount: paidAmount,
            currency,
            validatedAt: new Date(),
            lastGatewayResponse: {
                type: "validation",
                at: new Date().toISOString(),
                validation,
            },
        };

        // Update order status after verified payment (best-effort)
        if (order.orderStatus === "pending" && !order.requiresApproval) {
            order.orderStatus = "confirmed";
            order.lastStatusUpdate = new Date();
            order.trackingHistory = Array.isArray(order.trackingHistory) ? order.trackingHistory : [];
            order.trackingHistory.push({
                status: "payment_confirmed",
                message: `SSLCommerz payment received (Tran ID: ${tranId})`,
                timestamp: new Date(),
            });
        }

        await order.save();

        try {
            await sendMetaCapiPurchase({ req, order, eventId: order?.client?.metaEventId });
        } catch (e) {
            // best-effort
        }

        const redirectUrl = getFrontendRedirectUrl({ order, result: "success" });
        return res.status(200).send(buildRedirectHtml(redirectUrl, "Payment successful. Redirecting..."));
    } catch (error) {
        await updateOrderPaymentFailure({ order, payload, reason: error?.message || "Validation error" });
        const redirectUrl = getFrontendRedirectUrl({ order, result: "failed" });
        return res.status(500).send(buildRedirectHtml(redirectUrl, "Payment verification error. Redirecting..."));
    }
};

// @route POST /api/payments/sslcommerz/fail
exports.fail = async (req, res) => {
    const payload = readCallbackPayload(req);
    const tranId = payload.tran_id;

    const order = await findOrderByTranId(tranId);
    if (order) {
        await updateOrderPaymentFailure({ order, payload, reason: "Gateway fail callback" });
    }

    const redirectUrl = getFrontendRedirectUrl({ order, result: "failed" });
    return res.status(200).send(buildRedirectHtml(redirectUrl, "Payment failed. Redirecting..."));
};

// @route POST /api/payments/sslcommerz/cancel
exports.cancel = async (req, res) => {
    const payload = readCallbackPayload(req);
    const tranId = payload.tran_id;

    const order = await findOrderByTranId(tranId);
    if (order) {
        await updateOrderPaymentFailure({ order, payload, reason: "Gateway cancel callback" });
    }

    const redirectUrl = getFrontendRedirectUrl({ order, result: "cancel" });
    return res.status(200).send(buildRedirectHtml(redirectUrl, "Payment cancelled. Redirecting..."));
};

// @route POST /api/payments/sslcommerz/ipn
exports.ipn = async (req, res) => {
    const payload = readCallbackPayload(req);
    const tranId = payload.tran_id;
    const valId = payload.val_id;

    const order = await findOrderByTranId(tranId);
    if (!order) {
        return res.status(404).json({ success: false, message: "Order not found" });
    }

    // If already paid, accept idempotently.
    if (order.paymentStatus === "paid") {
        return res.status(200).json({ success: true, message: "Already paid" });
    }

    if (!valId) {
        await updateOrderPaymentFailure({ order, payload, reason: "Missing val_id (IPN)" });
        return res.status(400).json({ success: false, message: "Missing val_id" });
    }

    try {
        const validation = await validatePayment({ valId });
        const statusOk = isValidStatus(validation?.status);

        const paidAmount = toMoney(validation?.amount);
        const expectedAmount = toMoney(order.total);
        const currency = String(validation?.currency_type || validation?.currency || "BDT");

        const amountOk = Math.abs(paidAmount - expectedAmount) <= 0.5;
        const currencyOk = currency.toUpperCase() === "BDT";
        const tranOk = String(validation?.tran_id || "") === String(tranId || "");

        if (!statusOk || !amountOk || !currencyOk || !tranOk) {
            await updateOrderPaymentFailure({ order, payload, reason: "Validation mismatch (IPN)" });
            order.paymentDetails = {
                ...(order.paymentDetails || {}),
                provider: "sslcommerz",
                tranId: String(tranId || ""),
                valId: String(validation?.val_id || valId || ""),
                bankTranId: String(validation?.bank_tran_id || ""),
                cardType: String(validation?.card_type || ""),
                amount: paidAmount,
                currency,
                validatedAt: new Date(),
                lastGatewayResponse: {
                    type: "ipn_validation",
                    at: new Date().toISOString(),
                    validation,
                },
            };
            await order.save();
            return res.status(400).json({ success: false, message: "Invalid payment" });
        }

        order.paymentMethod = "sslcommerz";
        order.paymentStatus = "paid";
        order.paidAt = new Date();
        order.paymentDetails = {
            ...(order.paymentDetails || {}),
            provider: "sslcommerz",
            tranId: String(tranId || ""),
            valId: String(validation?.val_id || valId || ""),
            bankTranId: String(validation?.bank_tran_id || ""),
            cardType: String(validation?.card_type || ""),
            amount: paidAmount,
            currency,
            validatedAt: new Date(),
            lastGatewayResponse: {
                type: "ipn_validation",
                at: new Date().toISOString(),
                validation,
            },
        };

        if (order.orderStatus === "pending" && !order.requiresApproval) {
            order.orderStatus = "confirmed";
            order.lastStatusUpdate = new Date();
            order.trackingHistory = Array.isArray(order.trackingHistory) ? order.trackingHistory : [];
            order.trackingHistory.push({
                status: "payment_confirmed",
                message: `SSLCommerz payment received (IPN, Tran ID: ${tranId})`,
                timestamp: new Date(),
            });
        }

        await order.save();

        try {
            await sendMetaCapiPurchase({ req, order, eventId: order?.client?.metaEventId });
        } catch (e) {
            // best-effort
        }

        return res.status(200).json({ success: true, message: "Payment verified" });
    } catch (error) {
        await updateOrderPaymentFailure({ order, payload, reason: error?.message || "Validation error (IPN)" });
        return res.status(500).json({ success: false, message: "Validation error" });
    }
};
