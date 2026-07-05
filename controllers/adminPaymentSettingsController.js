const PaymentSettings = require("../models/PaymentSettings");
const { encryptSecret } = require("../utils/secretCrypto");

const toBool = (value, fallback) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        const v = value.trim().toLowerCase();
        if (v === "true") return true;
        if (v === "false") return false;
    }
    return fallback;
};

const safeView = (doc) => {
    const ssl = doc?.sslcommerz || {};
    const advance = doc?.advancePayment || {};
    const deliveryCharges = doc?.deliveryCharges || {};
    return {
        sslcommerz: {
            enabled: !!ssl.enabled,
            sandbox: typeof ssl.sandbox === "boolean" ? ssl.sandbox : true,
            storeId: String(ssl.storeId || ""),
            storePasswordConfigured: Boolean(ssl.storePasswordEnc),
            updatedAt: doc?.updatedAt || null,
        },
        advancePayment: {
            paymentNumber: String(advance.paymentNumber || "01995794410"),
            supportedMethods: Array.isArray(advance.supportedMethods) ? advance.supportedMethods : ["bkash", "nagad", "rocket", "upay"],
        },
        deliveryCharges: {
            insideDhaka: Number(deliveryCharges.insideDhaka || 70),
            outsideDhaka: Number(deliveryCharges.outsideDhaka || 120),
        },
    };
};

// @desc    Get payment settings (admin)
// @route   GET /api/admin/payment-settings
// @access  Private/Admin
exports.getPaymentSettings = async (req, res, next) => {
    try {
        const settings = await PaymentSettings.getSettings();
        res.status(200).json({ success: true, settings: safeView(settings) });
    } catch (error) {
        next(error);
    }
};

// @desc    Update payment settings (admin)
// @route   POST /api/admin/payment-settings
// @access  Private/Admin
exports.updatePaymentSettings = async (req, res, next) => {
    try {
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const incoming = body.sslcommerz && typeof body.sslcommerz === "object" ? body.sslcommerz : {};

        const settings = await PaymentSettings.getSettings();
        const current = settings.sslcommerz || {};

        const enabled = toBool(incoming.enabled, !!current.enabled);
        const sandbox = toBool(incoming.sandbox, typeof current.sandbox === "boolean" ? current.sandbox : true);
        const storeId = String(incoming.storeId ?? current.storeId ?? "").trim();

        let storePasswordEnc = String(current.storePasswordEnc || "");
        if (Object.prototype.hasOwnProperty.call(incoming, "storePassword")) {
            const storePassword = String(incoming.storePassword || "");
            if (storePassword) {
                storePasswordEnc = encryptSecret(storePassword);
            }
            // If empty string provided, keep existing secret.
        }

        if (enabled) {
            if (!storeId) {
                return res.status(400).json({
                    success: false,
                    message: "SSLCommerz Store ID is required to enable online payments",
                });
            }
            if (!storePasswordEnc) {
                return res.status(400).json({
                    success: false,
                    message: "SSLCommerz Store Password is required to enable online payments",
                });
            }
        }

        const advanceIncoming = body.advancePayment && typeof body.advancePayment === "object" ? body.advancePayment : {};
        const deliveryIncoming = body.deliveryCharges && typeof body.deliveryCharges === "object" ? body.deliveryCharges : {};

        const paymentNumber = String(advanceIncoming.paymentNumber ?? (settings.advancePayment?.paymentNumber || "01995794410")).trim();
        const supportedMethods = Array.isArray(advanceIncoming.supportedMethods)
            ? advanceIncoming.supportedMethods.map((m) => String(m || "").trim().toLowerCase()).filter(Boolean)
            : settings.advancePayment?.supportedMethods || ["bkash", "nagad", "rocket", "upay"];

        const insideDhaka = Number.isFinite(Number(deliveryIncoming.insideDhaka))
            ? Number(deliveryIncoming.insideDhaka)
            : Number(settings.deliveryCharges?.insideDhaka ?? 70);
        const outsideDhaka = Number.isFinite(Number(deliveryIncoming.outsideDhaka))
            ? Number(deliveryIncoming.outsideDhaka)
            : Number(settings.deliveryCharges?.outsideDhaka ?? 120);

        settings.sslcommerz = {
            enabled,
            sandbox,
            storeId,
            storePasswordEnc,
            lastUpdatedBy: req.user?._id || null,
        };

        settings.advancePayment = {
            paymentNumber,
            supportedMethods,
        };

        settings.deliveryCharges = {
            insideDhaka: insideDhaka >= 0 ? insideDhaka : 70,
            outsideDhaka: outsideDhaka >= 0 ? outsideDhaka : 120,
        };

        await settings.save();

        res.status(200).json({
            success: true,
            message: "Payment settings updated",
            settings: safeView(settings),
        });
    } catch (error) {
        // Explicitly surface missing encryption key errors.
        if (String(error?.message || "").includes("PAYMENT_SETTINGS_ENCRYPTION_KEY")) {
            return res.status(500).json({
                success: false,
                message:
                    "Server misconfigured: PAYMENT_SETTINGS_ENCRYPTION_KEY is missing. Set it before saving Store Password.",
            });
        }

        next(error);
    }
};
