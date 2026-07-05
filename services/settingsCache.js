const Settings = require("../models/Settings");

const parsePositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(String(value || ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const TTL_MS = parsePositiveInt(process.env.SETTINGS_CACHE_TTL_MS, 60 * 1000);

let cached = null;
let cachedAt = 0;
let inFlight = null;

const getSettingsCached = async () => {
    const now = Date.now();
    if (cached && now - cachedAt < TTL_MS) return cached;

    if (inFlight) return inFlight;

    inFlight = (async () => {
        const s = await Settings.getSettings();
        cached = s;
        cachedAt = Date.now();
        return cached;
    })();

    try {
        return await inFlight;
    } finally {
        inFlight = null;
    }
};

module.exports = {
    getSettingsCached,
};
