const express = require("express");
const { body, param } = require("express-validator");
const {
  createOrder,
  getOrders,
  getOrder,
  updateOrderStatus,
  updateOrder,
  deleteOrder,
  syncOrdersToSheets,
  getUnsyncedCount,
  trackGuestOrder,
  exportOrdersToSheets,
  trackOrder,
  trackOrderSearch,
  trackOrdersByPhone,
  approveOrder,
  rejectOrder,
  updateOrderPricing,
  updateOrderItems,
  updateAdvancePayment,
  markWhatsAppSent,
} = require("../controllers/orderController");
const { submitAdvanceRequest } = require("../controllers/advanceController");
const { protect, authorize, optionalAuth } = require("../middleware/auth");
const { validate } = require("../middleware/validator");
const { orderCreateLimiter, advancePaymentLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

const normalizePhone = (value) => {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return "";

  // Bangladesh canonicalization: +8801XXXXXXXXX / 8801XXXXXXXXX -> 01XXXXXXXXX
  if (digits.startsWith("8801") && digits.length === 13) {
    return `0${digits.slice(3)}`;
  }
  return digits;
};

const isValidBdPhone = (value) => {
  const phone = normalizePhone(value);
  return /^01[3-9]\d{8}$/.test(phone);
};

// Create order is public (guest checkout supported)
router.post(
  "/",
  optionalAuth,
  orderCreateLimiter,
  [
    body("orderItems")
      .optional()
      .isArray({ min: 1 })
      .withMessage("Order must have at least one item"),
    body("shippingAddress.firstName")
      .trim()
      .notEmpty()
      .withMessage("First name is required"),
    body("shippingAddress.phone")
      .trim()
      .notEmpty()
      .withMessage("Phone number is required")
      .custom((v) => {
        if (!isValidBdPhone(v)) {
          throw new Error("Phone number must be a valid Bangladesh number (01XXXXXXXXX)");
        }
        return true;
      }),
    body("shippingAddress.streetAddress")
      .trim()
      .notEmpty()
      .withMessage("Street address is required"),
    body("shippingAddress.townCity")
      .trim()
      .notEmpty()
      .withMessage("City is required"),
    body("paymentMethod")
      .optional()
      .isIn(["cash", "advance", "bkash", "card", "online", "sslcommerz"])
      .withMessage("Invalid payment method"),
  ],
  validate,
  createOrder
);
router.post("/track-guest", trackGuestOrder);
router.post("/track-by-phone", trackOrdersByPhone); // Track orders by phone number
router.post("/track-search", trackOrderSearch); // Flexible tracking search
router.get("/track/:orderId", trackOrder); // New tracking endpoint

router.post(
  "/:id/pay-advance",
  optionalAuth,
  advancePaymentLimiter,
  [
    param("id").isMongoId().withMessage("Invalid order id"),
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

// All other order routes require authentication
router.use(protect);

router.get("/", getOrders);
router.get("/unsynced-count", authorize("admin"), getUnsyncedCount);
router.post("/sync-sheets", authorize("admin"), syncOrdersToSheets);
router.post("/export-to-sheets", authorize("admin"), exportOrdersToSheets);
router.get("/:id", getOrder);
router.put("/:id", authorize("admin"), updateOrder);
router.put(
  "/:id/advance-payment",
  authorize("admin"),
  [
    body("advancePayment.paymentMethod")
      .optional()
      .isIn(["bkash", "nagad", "rocket", "upay"])
      .withMessage("Invalid advance payment method"),
    body("advancePayment.senderNumber")
      .optional()
      .trim(),
    body("advancePayment.transactionId")
      .optional()
      .trim(),
    body("advancePayment.amount")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("Paid amount must be a valid non-negative number"),
    body("advancePayment.status")
      .optional()
      .isIn(["Pending", "Verified", "Rejected", "None"])
      .withMessage("Invalid advance payment status"),
    body("advancePayment.rejectedReason").optional().trim(),
  ],
  validate,
  updateAdvancePayment
);
router.put(
  "/:id/pricing",
  authorize("admin"),
  [
    body("subtotal").optional().isFloat({ min: 0 }).withMessage("Subtotal must be a non-negative number"),
    body("discount").optional().isFloat({ min: 0 }).withMessage("Discount must be a non-negative number"),
    body("deliveryFee").optional().isFloat({ min: 0 }).withMessage("Delivery fee must be a non-negative number"),
    body("total").optional().isFloat({ min: 0 }).withMessage("Total must be a non-negative number"),
    body("reason")
      .trim()
      .isLength({ min: 3, max: 200 })
      .withMessage("Reason must be between 3 and 200 characters"),
  ],
  validate,
  updateOrderPricing
);
router.put("/:id/items", authorize("admin"), updateOrderItems);
router.put("/:id/status", authorize("admin"), updateOrderStatus);
router.put("/:id/approve", authorize("admin"), approveOrder);
router.put("/:id/reject", authorize("admin"), rejectOrder);
router.post("/:id/whatsapp-sent", authorize("admin"), markWhatsAppSent);
router.delete("/:id", authorize("admin"), deleteOrder);

module.exports = router;
