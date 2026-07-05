const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Simple JSON file for settings storage (replace with DB for production)
const SETTINGS_PATH = path.join(__dirname, '../config/analytics-settings.json');

function readSettings() {
    if (!fs.existsSync(SETTINGS_PATH)) return {};
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
}
function writeSettings(settings) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// GET settings
router.get('/settings', (req, res) => {
    res.json(readSettings());
});

// POST/PUT settings
router.post('/settings', (req, res) => {
    const settings = req.body;
    writeSettings(settings);
    res.json({ success: true });
});

// POST conversion event to Facebook Conversion API
router.post('/fb-conversion', async (req, res) => {
    const { pixelId, accessToken, eventName, eventData, testEventCode } = req.body;
    if (!pixelId || !accessToken || !eventName) {
        return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }
    try {
        const url = `https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${accessToken}`;
        const payload = {
            data: [
                {
                    event_name: eventName,
                    event_time: Math.floor(Date.now() / 1000),
                    ...eventData,
                    ...(testEventCode ? { test_event_code: testEventCode } : {})
                }
            ]
        };
        const fbRes = await axios.post(url, payload);
        res.json({ success: true, fbRes: fbRes.data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
