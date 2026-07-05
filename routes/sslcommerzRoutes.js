const express = require("express");
const router = express.Router();

const sslcommerzController = require("../controllers/sslcommerzController");

// Callback/IPN routes (public)
router.post("/success", sslcommerzController.success);
router.post("/fail", sslcommerzController.fail);
router.post("/cancel", sslcommerzController.cancel);
router.post("/ipn", sslcommerzController.ipn);

module.exports = router;
