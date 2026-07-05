const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/auth");
const {
  getColors,
  getColor,
  createColor,
  updateColor,
  deleteColor,
} = require("../controllers/colorController");

// Public routes
router.get("/", getColors);
router.get("/:id", getColor);

// Admin routes
router.post("/", protect, authorize("admin"), createColor);
router.put("/:id", protect, authorize("admin"), updateColor);
router.delete("/:id", protect, authorize("admin"), deleteColor);

module.exports = router;
