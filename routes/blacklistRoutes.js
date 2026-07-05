const express = require("express");

const {
    getBlacklist,
    createBlacklistEntry,
    deleteBlacklistEntry,
} = require("../controllers/blacklistController");

const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

router.use(protect);
router.use(authorize("admin"));

router.get("/", getBlacklist);
router.post("/", createBlacklistEntry);
router.delete("/:id", deleteBlacklistEntry);

module.exports = router;
