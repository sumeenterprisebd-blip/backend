const express = require("express");
const router = express.Router();
const {
  getHomepagePopup,
  getPopups,
  getPopup,
  createPopup,
  updatePopup,
  deletePopup,
  togglePopupStatus,
} = require("../controllers/popupController");
const { protect, authorize } = require("../middleware/auth");

// Public routes
router.get("/homepage", getHomepagePopup);

// Admin routes
router.use(protect);
router.use(authorize("admin"));

router.route("/").get(getPopups).post(createPopup);

router.route("/:id").get(getPopup).put(updatePopup).delete(deletePopup);

router.patch("/:id/toggle", togglePopupStatus);

module.exports = router;
