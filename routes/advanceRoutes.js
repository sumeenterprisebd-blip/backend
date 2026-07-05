const express = require("express");
const { body } = require("express-validator");
const { validate } = require("../middleware/validator");
const {
    checkUserStatus,
    submitAdvanceRequest,
} = require("../controllers/advanceController");

const router = express.Router();

router.post(
    "/check-user-status",
    [
        body("phone")
            .trim()
            .notEmpty()
            .withMessage("Phone number is required"),
        body("townCity")
            .optional()
            .trim(),
    ],
    validate,
    checkUserStatus
);

router.post(
    "/submit-advance",
    [
        body("customerPhone")
            .trim()
            .notEmpty()
            .withMessage("Customer phone is required"),
        body("townCity")
            .trim()
            .notEmpty()
            .withMessage("Delivery city is required"),
        body("paymentMethod")
            .trim()
            .isIn(["bkash", "nagad", "rocket", "upay"])
            .withMessage("Payment method must be one of bkash, nagad, rocket, upay"),
        body("senderNumber")
            .trim()
            .notEmpty()
            .withMessage("Sender mobile number is required"),

        body("paidAmount")
            .isFloat({ min: 0.01 })
            .withMessage("Paid amount must be a positive number"),
    ],
    validate,
    submitAdvanceRequest
);

module.exports = router;
