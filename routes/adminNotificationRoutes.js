const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
    getAdminNotifications,
    getAdminUnreadCount,
    markAdminNotificationRead,
    markAdminNotificationUnread,
    markAllAdminNotificationsRead,
    deleteAdminNotification,
} = require("../controllers/notificationController");

const router = express.Router();

router.use(protect, authorize("admin"));
router.get("/", getAdminNotifications);
router.get("/unread-count", getAdminUnreadCount);
router.patch("/read-all", markAllAdminNotificationsRead);
router.patch("/:id/read", markAdminNotificationRead);
router.patch("/:id/unread", markAdminNotificationUnread);
router.delete("/:id", deleteAdminNotification);

module.exports = router;
