// Removed Facebook video routes

// const express = require("express");
// const router = express.Router();
// const { getFacebookVideos, getActiveFacebookVideos, ... } = require("../controllers/facebookVideoController");
// router.get("/active", getActiveFacebookVideos);
// router.post("/:id/click", trackFacebookVideoClick);
// router.use(protect);
// router.use(authorize("admin"));
// router.route("/").get(getFacebookVideos).post(createFacebookVideo);
// router.get("/analytics", getFacebookVideoAnalytics);
// router.route("/:id").get(getFacebookVideo).put(updateFacebookVideo).delete(deleteFacebookVideo);
// router.patch("/:id/toggle", toggleFacebookVideoStatus);
// module.exports = router;
const express = require("express");
const router = express.Router();
const {
  getFacebookVideos,
  getActiveFacebookVideos,
  getFacebookVideo,
  createFacebookVideo,
  updateFacebookVideo,
  deleteFacebookVideo,
  toggleFacebookVideoStatus,
  trackFacebookVideoClick,
  getFacebookVideoAnalytics,
} = require("../controllers/facebookVideoController");
const { protect, authorize } = require("../middleware/auth");

// Public routes
router.get("/active", getActiveFacebookVideos);
router.post("/:id/click", trackFacebookVideoClick);

// Admin routes
router.use(protect);
router.use(authorize("admin"));

router.route("/").get(getFacebookVideos).post(createFacebookVideo);

router.get("/analytics", getFacebookVideoAnalytics);

router
  .route("/:id")
  .get(getFacebookVideo)
  .put(updateFacebookVideo)
  .delete(deleteFacebookVideo);

router.patch("/:id/toggle", toggleFacebookVideoStatus);

module.exports = router;
