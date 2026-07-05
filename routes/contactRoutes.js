const express = require("express");
const {
  sendContactMessage,
  getAllMessages,
  getMessageById,
  toggleReadStatus,
  deleteMessage,
  getMessageStats,
} = require("../controllers/contactController");
const { protect, admin } = require("../middleware/auth");

const router = express.Router();

// Public route
router.post("/", sendContactMessage);

// Admin routes
router.get("/admin/messages", protect, admin, getAllMessages);
router.get("/admin/messages/:id", protect, admin, getMessageById);
router.patch("/admin/messages/:id/read", protect, admin, toggleReadStatus);
router.delete("/admin/messages/:id", protect, admin, deleteMessage);
router.get("/admin/stats", protect, admin, getMessageStats);

module.exports = router;
