const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
    getVapidPublicKey,
    subscribeAdmin,
    unsubscribeAdmin,
    subscribeUser,
    unsubscribeUser,
    subscribeGuest,
    unsubscribeGuest,
} = require("../controllers/pushController");

const router = express.Router();

router.get("/public-key", getVapidPublicKey);
router.post("/subscribe", protect, authorize("admin"), subscribeAdmin);
router.post("/unsubscribe", protect, authorize("admin"), unsubscribeAdmin);

router.post("/subscribe-user", protect, subscribeUser);
router.post("/unsubscribe-user", protect, unsubscribeUser);

router.post("/subscribe-guest", subscribeGuest);
router.post("/unsubscribe-guest", unsubscribeGuest);

module.exports = router;

