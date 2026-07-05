const axios = require("axios");
const PaymentSettings = require("../models/PaymentSettings");
const { decryptSecret } = require("../utils/secretCrypto");

const toMoney = (value) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
};

const getBackendBaseUrl = (req) => {
    const proto = String(req.get("x-forwarded-proto") || req.protocol || "https");
    const host = String(req.get("x-forwarded-host") || req.get("host") || "");
    return host ? `${proto}://${host}` : "";
};

const getFrontendBaseUrl = () => {
    const url = String(process.env.FRONTEND_URL || "").trim();
    return url || "";
};

const getEndpoints = (sandbox) => {
    const useSandbox = !!sandbox;
    return {
        init: useSandbox
            ? "https://sandbox.sslcommerz.com/gwprocess/v4/api.php"
            : "https://securepay.sslcommerz.com/gwprocess/v4/api.php",
        validate: useSandbox
            ? "https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php"
            : "https://securepay.sslcommerz.com/validator/api/validationserverAPI.php",
    };
};

const getSslcommerzCreds = async () => {
    const settings = await PaymentSettings.getSettings();
    const ssl = settings?.sslcommerz || {};

    const enabled = Boolean(ssl.enabled);
    const sandbox = typeof ssl.sandbox === "boolean" ? ssl.sandbox : true;
    const storeId = String(ssl.storeId || "").trim();
    const storePasswordEnc = String(ssl.storePasswordEnc || "");

    const storePassword = storePasswordEnc ? decryptSecret(storePasswordEnc) : "";

    return {
        enabled,
        sandbox,
        storeId,
        storePassword,
    };
};

exports.getPublicSslcommerzAvailability = async () => {
    const settings = await PaymentSettings.getSettings();
    const ssl = settings?.sslcommerz || {};
    return {
        enabled: Boolean(ssl.enabled),
    };
};

exports.initiatePayment = async ({ req, order }) => {
    const creds = await getSslcommerzCreds();
    if (!creds.enabled) {
        const err = new Error("Online payment is not enabled");
        err.statusCode = 400;
        throw err;
    }

    if (!creds.storeId || !creds.storePassword) {
        const err = new Error("Online payment is not configured");
        err.statusCode = 500;
        throw err;
    }

    const endpoints = getEndpoints(creds.sandbox);

    const backendBaseUrl = process.env.BACKEND_URL
        ? String(process.env.BACKEND_URL).replace(/\/$/, "")
        : getBackendBaseUrl(req);

    if (!backendBaseUrl) {
        const err = new Error("Unable to determine backend URL");
        err.statusCode = 500;
        throw err;
    }

    const tranId = order?.paymentDetails?.tranId || `DW_${order?.orderNumber || order?._id}`;

    const success_url = `${backendBaseUrl}/api/payments/sslcommerz/success`;
    const fail_url = `${backendBaseUrl}/api/payments/sslcommerz/fail`;
    const cancel_url = `${backendBaseUrl}/api/payments/sslcommerz/cancel`;
    const ipn_url = `${backendBaseUrl}/api/payments/sslcommerz/ipn`;

    const amount = toMoney(order?.total || 0);
    const currency = "BDT";

    const shipping = order?.shippingAddress || {};
    const customerName = [shipping.firstName, shipping.lastName].filter(Boolean).join(" ").trim() || "Customer";

    const params = new URLSearchParams({
        store_id: creds.storeId,
        store_passwd: creds.storePassword,
        total_amount: String(amount),
        currency,
        tran_id: String(tranId),
        success_url,
        fail_url,
        cancel_url,
        ipn_url,

        cus_name: customerName,
        cus_email: String(shipping.email || order?.guestInfo?.email || "").trim() || "support@deshwear.com",
        cus_add1: String(shipping.streetAddress || "").trim() || "N/A",
        cus_city: String(shipping.townCity || "").trim() || "Dhaka",
        cus_state: String(shipping.state || "").trim() || "Dhaka",
        cus_postcode: String(shipping.zipCode || "").trim() || "",
        cus_country: String(shipping.country || "Bangladesh").trim() || "Bangladesh",
        cus_phone: String(shipping.phone || order?.guestInfo?.phone || "").trim() || "",

        shipping_method: "NO",
        product_name: `Order #${order?.orderNumber || order?._id}`,
        product_category: "Ecommerce",
        product_profile: "general",

        value_a: String(order?._id || ""),
        value_b: String(order?.shortId || ""),
        value_c: String(shipping.phone || order?.guestInfo?.phone || ""),
    });

    const response = await axios.post(endpoints.init, params.toString(), {
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 30000,
    });

    return {
        tranId,
        gateway: response?.data || null,
    };
};

exports.validatePayment = async ({ valId }) => {
    const creds = await getSslcommerzCreds();
    if (!creds.storeId || !creds.storePassword) {
        const err = new Error("Online payment is not configured");
        err.statusCode = 500;
        throw err;
    }

    const endpoints = getEndpoints(creds.sandbox);

    const res = await axios.get(endpoints.validate, {
        params: {
            val_id: String(valId || "").trim(),
            store_id: creds.storeId,
            store_passwd: creds.storePassword,
            v: 1,
            format: "json",
        },
        timeout: 30000,
    });

    return res?.data || null;
};

exports.getFrontendRedirectUrl = ({ order, result }) => {
    const base = getFrontendBaseUrl();
    if (!base) return "";

    const trackingId = order?.orderNumber || order?.shortId || order?._id;
    const status = String(result || "").toLowerCase();

    const url = new URL("/orders/track", base);
    if (trackingId) url.searchParams.set("id", String(trackingId));
    if (status) url.searchParams.set("payment", status);
    // Include meta event id for deduplication if available so the frontend
    // can fire a browser Purchase event with matching event_id when the user
    // is redirected back from the gateway.
    const metaEventId = order?.client?.metaEventId || order?.metaEventId;
    if (metaEventId) url.searchParams.set("event_id", String(metaEventId));
    return url.toString();
};
