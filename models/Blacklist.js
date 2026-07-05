const mongoose = require("mongoose");

const normalizePhone = (value) => {
    const digits = String(value || "").replace(/[^\d]/g, "");
    if (!digits) return "";

    // Bangladesh canonicalization: +8801XXXXXXXXX / 8801XXXXXXXXX -> 01XXXXXXXXX
    if (digits.startsWith("8801") && digits.length === 13) {
        return `0${digits.slice(3)}`;
    }

    return digits;
};

const normalizeIp = (value) => {
    const ip = String(value || "").trim();
    return ip;
};

const normalizeAddress = (value) => {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return "";

    // Keep letters/numbers/spaces + a few separators; collapse whitespace.
    return raw
        .replace(/[^\p{L}\p{N}\s,./-]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
};

const normalizeBlacklistValue = (type, value) => {
    const t = String(type || "").trim().toLowerCase();
    if (!t) return "";

    if (t === "phone") return normalizePhone(value);
    if (t === "ip") return normalizeIp(value);
    if (t === "address") return normalizeAddress(value);

    return "";
};

const BlacklistSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ["phone", "ip", "address"],
            required: true,
            index: true,
        },
        value: {
            type: String,
            required: true,
            trim: true,
        },
        normalized: {
            type: String,
            required: true,
            index: true,
        },
        reason: {
            type: String,
            trim: true,
            default: "",
        },
        active: {
            type: Boolean,
            default: true,
            index: true,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
    },
    { timestamps: true }
);

// Only one active entry per (type, normalized)
BlacklistSchema.index(
    { type: 1, normalized: 1 },
    { unique: true, partialFilterExpression: { active: true } }
);

BlacklistSchema.statics.normalize = normalizeBlacklistValue;

module.exports = mongoose.model("Blacklist", BlacklistSchema);
