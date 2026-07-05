const express = require("express");
const { body } = require("express-validator");
const { protect, authorize } = require("../middleware/auth");
const { validate } = require("../middleware/validator");
const {
    getAdvancePayments,
    approveAdvancePayment,
    rejectAdvancePayment,
    editAdvancePayment,
} = require("../controllers/advanceController");

const router = express.Router();

router.use(protect);
router.use(authorize("admin"));

router.get(
    "/advance-list",
    validate,
    getAdvancePayments
);

router.post(
    "/approve-advance",
    [
        body("id").isMongoId().withMessage("Invalid advance payment id"),
    ],
    validate,
    approveAdvancePayment
);

router.post(
    "/reject-advance",
    [
        body("id").isMongoId().withMessage("Invalid advance payment id"),
        body("reason").optional().trim(),
    ],
    validate,
    rejectAdvancePayment
);

router.put(
    "/edit-advance",
    [
        body("id").isMongoId().withMessage("Invalid advance payment id"),
        body("senderNumber")
            .optional()
            .trim(),
        body("transactionId")
            .optional()
            .trim(),
        body("trxIdLast4")
            .optional()
            .trim()
            .matches(/^\d{4}$/)
            .withMessage("Last 4 digits of transaction ID must be numeric"),
        body("paidAmount")
            .optional()
            .isFloat({ min: 0 })
            .withMessage("Paid amount must be a valid number"),
    ],
    validate,
    editAdvancePayment
);

module.exports = router;
