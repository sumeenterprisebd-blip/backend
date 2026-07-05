const express = require("express");
const {
  getProductReviews,
  getPublicReviews,
  createReview,
  updateReview,
  deleteReview,
  getPendingReviews,
  approveReview,
  rejectReview,
  checkReviewExists,
  adminCreateReview,
  getAllReviews,
} = require("../controllers/reviewController");
const { protect, admin } = require("../middleware/auth");

const router = express.Router();

// Public routes
router.get("/product/:productId", getProductReviews);
router.get("/public", getPublicReviews);

// Protected routes
router.use(protect);

router.get("/check/:orderId/:productId", checkReviewExists);
router.post("/", createReview);
router.put("/:id", updateReview);
router.delete("/:id", deleteReview);

// Admin routes
router.get("/admin/all", admin, getAllReviews);
router.get("/pending", admin, getPendingReviews);
router.post("/admin", admin, adminCreateReview);
router.put("/:id/approve", admin, approveReview);
router.put("/:id/reject", admin, rejectReview);

module.exports = router;
