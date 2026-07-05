const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const { getAdminAnalytics } = require("../controllers/adminAnalyticsController");

const router = express.Router();

router.get("/", protect, authorize("admin", "moderator"), getAdminAnalytics);


module.exports = router;
