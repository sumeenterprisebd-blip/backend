const crypto = require("crypto");

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

const getKey = () => {
    const raw = String(process.env.PAYMENT_SETTINGS_ENCRYPTION_KEY || "");
    if (!raw) return null;

    return crypto.createHash("sha256").update(raw, "utf8").digest();
};

exports.encryptSecret = (plainText) => {
    const text = String(plainText ?? "");
    if (!text) return "";

    const key = getKey();
    if (!key) {
        throw new Error("Missing PAYMENT_SETTINGS_ENCRYPTION_KEY");
    }

    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const cipherText = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${iv.toString("hex")}:${tag.toString("hex")}:${cipherText.toString("hex")}`;
};

exports.decryptSecret = (payload) => {
    const raw = String(payload ?? "");
    if (!raw) return "";

    const key = getKey();
    if (!key) {
        throw new Error("Missing PAYMENT_SETTINGS_ENCRYPTION_KEY");
    }

    const parts = raw.split(":");
    if (parts.length !== 3) {
        throw new Error("Invalid secret payload");
    }

    const [ivHex, tagHex, cipherHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const cipherText = Buffer.from(cipherHex, "hex");

    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return plain.toString("utf8");
};
