const express = require("express");
const { protect } = require("../middleware/auth");
const {
    getMyNotifications,
    getMyUnreadCount,
    markMyNotificationRead,
    markAllMyNotificationsRead,
    getGuestNotifications,
    getGuestUnreadCount,
    markGuestNotificationRead,
    markAllGuestNotificationsRead,
} = require("../controllers/notificationController");

const router = express.Router();

router.get("/", protect, getMyNotifications);
router.get("/unread-count", protect, getMyUnreadCount);
router.patch("/read-all", protect, markAllMyNotificationsRead);
router.patch("/:id/read", protect, markMyNotificationRead);

// Guest (public, phone-verified)
router.post("/guest", getGuestNotifications);
router.post("/guest/unread-count", getGuestUnreadCount);
router.patch("/guest/read-all", markAllGuestNotificationsRead);
router.patch("/guest/:id/read", markGuestNotificationRead);

module.exports = router;
