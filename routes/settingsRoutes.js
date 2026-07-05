const express = require("express");
const router = express.Router();
const {
  getSettings,
  updateSettings,
  uploadLogo,
} = require("../controllers/settingsController");
const { protect, admin } = require("../middleware/auth");

// Public route to get settings
router.get("/", getSettings);

// Admin routes
router.put("/", protect, admin, updateSettings);
router.post("/logo", protect, admin, uploadLogo);

module.exports = router;
