const express = require("express");
const router = express.Router();

const { protect, admin } = require("../middleware/auth");
const {
    getPaymentSettings,
    updatePaymentSettings,
} = require("../controllers/adminPaymentSettingsController");

router.get("/", protect, admin, getPaymentSettings);
router.post("/", protect, admin, updatePaymentSettings);

module.exports = router;
