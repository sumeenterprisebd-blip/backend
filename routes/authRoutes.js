
const express = require("express");
const rateLimit = require("express-rate-limit");
const { body } = require("express-validator");
const {
  register,
  login,
  getMe,
  forgotPassword,
  verifyForgotPasswordOtp,
  resetPassword,
  requestEmailOtp,
  verifyEmailOtp,
} = require("../controllers/authController");
const { protect } = require("../middleware/auth");
const { validate } = require("../middleware/validator");

const router = express.Router();

const normalizePhone = (value) => {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("8801") && digits.length === 13) {
    return `0${digits.slice(3)}`;
  }
  return digits;
};

const isValidBdPhone = (value) => /^01[3-9]\d{8}$/.test(normalizePhone(value));

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: "Too many authentication attempts, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

// Separate limiter for OTP endpoints
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // 3 OTP actions per window
  message: "Too many OTP requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

// Password reset limiter (covers request + verify + reset)
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  message: "Too many password reset attempts, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

// @route   POST /api/auth/register
router.post(
  "/register",
  authLimiter,
  [
    body("firstName").trim().notEmpty().withMessage("First name is required"),
    body("lastName").trim().notEmpty().withMessage("Last name is required"),
    body("email").isEmail().withMessage("Please provide a valid email"),
    body("phone")
      .trim()
      .notEmpty()
      .withMessage("Phone number is required")
      .custom((v) => {
        if (!isValidBdPhone(v)) {
          throw new Error("Phone number must be a valid Bangladesh number (01XXXXXXXXX)");
        }
        return true;
      }),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
  ],
  validate,
  register
);

// @route   POST /api/auth/login
router.post(
  "/login",
  authLimiter,
  [
    body("email")
      .isEmail()
      .withMessage("Please provide a valid email")
      .normalizeEmail(),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  validate,
  login
);

// Google login route removed


// @route   POST /api/auth/forgot-password
router.post(
  "/forgot-password",
  passwordResetLimiter,
  [body("email").isEmail().withMessage("Please provide a valid email")],
  validate,
  forgotPassword
);

// @route   POST /api/auth/forgot-password/verify-otp
router.post(
  "/forgot-password/verify-otp",
  passwordResetLimiter,
  [
    body("email").isEmail().withMessage("Please provide a valid email"),
    body("code")
      .trim()
      .isLength({ min: 6, max: 6 })
      .withMessage("OTP code must be 6 digits")
      .isNumeric()
      .withMessage("OTP code must be numeric"),
  ],
  validate,
  verifyForgotPasswordOtp
);

// @route   POST /api/auth/reset-password
router.post(
  "/reset-password",
  passwordResetLimiter,
  [
    body("token").trim().notEmpty().withMessage("Reset token is required"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
  ],
  validate,
  resetPassword
);


// ...existing code...

// @route   GET /api/auth/me
router.get("/me", protect, getMe);

// @route   POST /api/auth/email-otp/request
router.post("/email-otp/request", protect, otpLimiter, requestEmailOtp);

// @route   POST /api/auth/email-otp/verify
router.post(
  "/email-otp/verify",
  protect,
  otpLimiter,
  [
    body("code")
      .trim()
      .isLength({ min: 6, max: 6 })
      .withMessage("OTP code must be 6 digits")
      .isNumeric()
      .withMessage("OTP code must be numeric"),
  ],
  validate,
  verifyEmailOtp
);

// @route   GET /api/auth/session
// Lightweight session endpoint for frontend NextAuth client fallback
router.get("/session", (req, res) => {
  res.status(200).json({ user: null, expires: null });
});

module.exports = router;
