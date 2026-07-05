const express = require("express");
const {
    getPathaoStatus,
    testPathaoAuth,
} = require("../controllers/pathaoController");
const { protect, admin } = require("../middleware/auth");

const router = express.Router();

router.get("/status", getPathaoStatus);
router.post("/auth-test", protect, admin, testPathaoAuth);

module.exports = router;
