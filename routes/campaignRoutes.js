const express = require("express");
const {
  getCampaigns,
  getActiveCampaign,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  toggleCampaignStatus,
  trackCampaignClick,
  getCampaignAnalytics,
} = require("../controllers/campaignController");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

// Public routes
router.get("/active", getActiveCampaign);
router.post("/:id/click", trackCampaignClick);

// Admin routes
router.use(protect);
router.use(authorize("admin"));

router.route("/").get(getCampaigns).post(createCampaign);

router
  .route("/:id")
  .get(getCampaign)
  .put(updateCampaign)
  .delete(deleteCampaign);

router.patch("/:id/toggle", toggleCampaignStatus);
router.get("/:id/analytics", getCampaignAnalytics);

module.exports = router;
