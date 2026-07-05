const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/auth");
const {
  getHeroes,
  getActiveHeroes,
  getHero,
  createHero,
  updateHero,
  deleteHero,
  toggleHeroStatus,
  trackHeroClick,
  updateHeroPriority,
  getHeroAnalytics,
} = require("../controllers/heroController");

// Public routes
router.get("/active", getActiveHeroes);
router.post("/:id/click", trackHeroClick);

// Admin routes
router.use(protect);
router.use(authorize("admin"));

router.route("/").get(getHeroes).post(createHero);

router.route("/:id").get(getHero).put(updateHero).delete(deleteHero);

router.patch("/:id/toggle", toggleHeroStatus);
router.patch("/:id/priority", updateHeroPriority);
router.get("/:id/analytics", getHeroAnalytics);

module.exports = router;
