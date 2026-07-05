// ...existing code...
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const Order = require("../models/Order");
const Notification = require("../models/Notification");

const normalizePhone = (value) => {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("8801") && digits.length === 13) {
    return `0${digits.slice(3)}`;
  }
  return digits;
};

const isValidBdPhone = (value) => /^01[3-9]\d{8}$/.test(normalizePhone(value));

const linkOrdersToUserByPhone = async (userId, phone) => {
  const phoneDigits = normalizePhone(phone);
  if (!userId || !phoneDigits || !isValidBdPhone(phoneDigits)) return { linked: 0, skipped: true };

  // Prevent accidental cross-account leakage when duplicate phones exist.
  const dup = await User.countDocuments({ phone: phoneDigits, _id: { $ne: userId } });
  if (dup > 0) return { linked: 0, skipped: true };

  const result = await Order.updateMany(
    {
      $and: [
        {
          $or: [
            { "shippingAddress.phone": phoneDigits },
            { "guestInfo.phone": phoneDigits },
          ],
        },
        { $or: [{ user: null }, { user: { $exists: false } }] },
      ],
    },
    {
      $set: { user: userId },
    }
  );

  return {
    linked: Number(result?.modifiedCount || result?.nModified || 0),
    skipped: false,
  };
};

const linkNotificationsToUserByPhone = async (userId, phone) => {
  const phoneDigits = normalizePhone(phone);
  if (!userId || !phoneDigits || !isValidBdPhone(phoneDigits)) return { linked: 0, skipped: true };

  // Prevent accidental cross-account leakage when duplicate phones exist.
  const dup = await User.countDocuments({ phone: phoneDigits, _id: { $ne: userId } });
  if (dup > 0) return { linked: 0, skipped: true };

  const result = await Notification.updateMany(
    {
      guestPhone: phoneDigits,
      $or: [{ user: null }, { user: { $exists: false } }],
    },
    {
      $set: { user: userId },
      $unset: { guestPhone: "" },
    }
  );

  return {
    linked: Number(result?.modifiedCount || result?.nModified || 0),
    skipped: false,
  };
};

// Generate JWT Token
const generateToken = (id) => {
  if (!process.env.JWT_EXPIRE) {
    throw new Error("JWT_EXPIRE must be set in environment variables");
  }
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

// ...existing code...
const nodemailer = require("nodemailer");

// @desc    Forgot Password
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const normalizedEmail = String(email || "").toLowerCase().trim();

    // Always respond success to avoid account enumeration.
    const genericSuccess = {
      success: true,
      message: "If that email is registered, a verification code has been sent.",
    };

    const user = await User.findOne({ email: normalizedEmail }).select(
      "+passwordResetOtpHash +passwordResetOtpExpire +passwordResetOtpLastSentAt +passwordResetOtpAttempts"
    );

    if (!user) {
      return res.status(200).json(genericSuccess);
    }

    const last = user.passwordResetOtpLastSentAt
      ? new Date(user.passwordResetOtpLastSentAt).getTime()
      : 0;

    // Resend throttle (silent to avoid leaking whether a user exists).
    if (last && Date.now() - last < 60 * 1000) {
      return res.status(200).json(genericSuccess);
    }

    const code = generateOtpCode();
    const expiresMinutes = Math.max(
      2,
      Number.parseInt(process.env.PASSWORD_RESET_OTP_EXPIRE_MINUTES || "10", 10)
    );

    user.passwordResetOtpHash = hashOtp(code);
    user.passwordResetOtpExpire = new Date(Date.now() + expiresMinutes * 60 * 1000);
    user.passwordResetOtpLastSentAt = new Date();
    user.passwordResetOtpAttempts = 0;
    await user.save({ validateBeforeSave: false });

    const transporter = buildSmtpTransporter();
    await transporter.sendMail({
      from: `"DeshWear Support" <${process.env.FROM_EMAIL || process.env.SMTP_USER}>`,
      to: user.email,
      subject: `Reset your password code (${expiresMinutes} min)`,
      text: (() => {
        const brandName = process.env.BRAND_NAME || "DeshWear";
        const safeCode = String(code || "").replace(/[^0-9]/g, "");
        return `${brandName} password reset code: ${safeCode}. Expires in ${expiresMinutes} minutes. Do not share this code with anyone.`;
      })(),
      html: (() => {
        const brandName = process.env.BRAND_NAME || "DeshWear";
        const primary = process.env.BRAND_PRIMARY_COLOR || "#3b82f6";
        const accent = process.env.BRAND_ACCENT_COLOR || "#a855f7";
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
        const logoUrl = process.env.BRAND_LOGO_URL || `${frontendUrl}/logo.jpeg`;
        const supportEmail = process.env.SUPPORT_EMAIL || process.env.FROM_EMAIL || process.env.SMTP_USER || "";
        const supportPhone = process.env.SUPPORT_PHONE || "";
        const websiteUrl = process.env.BRAND_WEBSITE_URL || frontendUrl;
        const addressLine = process.env.BUSINESS_ADDRESS || "";
        const safeCode = String(code || "").replace(/[^0-9]/g, "");

        return `
<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>${brandName} Password Reset Code</title>
    <style>
      @media (max-width: 480px) {
        .container { width: 100% !important; }
        .p-outer { padding: 18px 10px !important; }
        .p-card { padding: 18px 16px !important; }
        .otp { font-size: 28px !important; letter-spacing: 0.22em !important; }
      }
    </style>
  </head>
  <body style="margin:0; padding:0; background:#f6f8fb;">
    <!-- Preheader (hidden) -->
    <div style="display:none; font-size:1px; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden; mso-hide:all;">
      Your one-time code is ${safeCode}. It expires in ${expiresMinutes} minutes.
    </div>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse; background:#f6f8fb;">
      <tr>
        <td align="center" class="p-outer" style="padding:24px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="container" style="max-width:560px; border-collapse:separate;">
            <!-- Header -->
            <tr>
              <td style="padding:12px 12px 16px 12px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
                  <tr>
                    <td align="left" style="vertical-align:middle;">
                      <img src="${logoUrl}" width="40" height="40" alt="${brandName}" style="display:block; width:40px; height:40px; border-radius:10px;" />
                    </td>
                    <td align="left" style="vertical-align:middle; padding-left:12px;">
                      <div style="font-family:Arial, sans-serif; font-size:16px; font-weight:800; color:#111827; line-height:1.2;">${brandName}</div>
                      <div style="font-family:Arial, sans-serif; font-size:12px; color:#6b7280; line-height:1.2;">Password Recovery</div>
                    </td>
                    <td align="right" style="vertical-align:middle;">
                      <div style="font-family:Arial, sans-serif; font-size:12px; color:#6b7280;">Secure OTP</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Card -->
            <tr>
              <td style="background:#ffffff; border:1px solid #e5e7eb; border-radius:16px; overflow:hidden;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
                  <tr>
                    <td style="padding:0;">
                      <div style="height:6px; background:${primary}; background:linear-gradient(90deg, ${primary}, ${accent});"></div>
                    </td>
                  </tr>
                  <tr>
                    <td class="p-card" style="padding:24px 22px 8px 22px;">
                      <div style="font-family:Arial, sans-serif; font-size:20px; font-weight:900; color:#111827; line-height:1.25;">
                        Password Reset Request
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td class="p-card" style="padding:0 22px 18px 22px;">
                      <div style="font-family:Arial, sans-serif; font-size:14px; color:#374151; line-height:1.6;">
                        We received a request to reset the password for your ${brandName} account.
                        Use the one-time code below to continue.
                        <br/>
                        This code expires in <strong>${expiresMinutes} minutes</strong>.
                      </div>
                    </td>
                  </tr>

                  <!-- OTP code block -->
                  <tr>
                    <td align="center" style="padding:0 22px 18px 22px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
                        <tr>
                          <td align="center" style="background:#f3f4f6; border:1px solid #e5e7eb; border-radius:14px; padding:14px 18px;">
                            <div style="font-family:Arial, sans-serif; font-size:12px; color:#6b7280; letter-spacing:0.06em; text-transform:uppercase; margin-bottom:6px;">Your OTP Code</div>
                            <div class="otp" style="font-family:Arial, sans-serif; font-size:34px; font-weight:900; color:#111827; letter-spacing:0.28em; padding-left:0.28em;">
                              ${safeCode}
                            </div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:0 22px 10px 22px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;">
                        <tr>
                          <td style="background:#fff7ed; border:1px solid #fed7aa; border-radius:12px; padding:12px 12px;">
                            <div style="font-family:Arial, sans-serif; font-size:13px; color:#7c2d12; line-height:1.6;">
                              <strong>Security notice:</strong> Do not share this code with anyone. ${brandName} will never ask you for this OTP.
                            </div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:0 22px 6px 22px;">
                      <div style="font-family:Arial, sans-serif; font-size:13px; color:#4b5563; line-height:1.6;">
                        If you didn’t request a password reset, you can ignore this email.
                      </div>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:18px 22px 22px 22px;">
                      <div style="font-family:Arial, sans-serif; font-size:12px; color:#9ca3af; line-height:1.6; border-top:1px solid #f3f4f6; padding-top:14px;">
                        Having trouble? Copy and paste the code into the verification screen.
                        <br/>
                        © ${new Date().getFullYear()} ${brandName}
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:16px 12px 0 12px;">
                <div style="font-family:Arial, sans-serif; font-size:12px; color:#9ca3af; line-height:1.6; text-align:center;">
                  ${supportEmail ? `Need help? <a href="mailto:${supportEmail}" style="color:${primary}; text-decoration:none;">${supportEmail}</a><br/>` : ''}
                  ${supportPhone ? `${supportPhone}<br/>` : ''}
                  <a href="${websiteUrl}" style="color:${primary}; text-decoration:none;">${websiteUrl}</a>
                  ${addressLine ? `<br/>${addressLine}` : ''}
                  <br/>
                  This is an automated message. Please do not reply.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
        `.trim();
      })(),
    });

    return res.status(200).json(genericSuccess);
  } catch (error) {
    next(error);
  }
};

// @desc    Verify forgot-password OTP
// @route   POST /api/auth/forgot-password/verify-otp
// @access  Public
exports.verifyForgotPasswordOtp = async (req, res, next) => {
  try {
    const { email, code } = req.body;
    const normalizedEmail = String(email || "").toLowerCase().trim();
    const raw = String(code || "").trim();

    const user = await User.findOne({ email: normalizedEmail }).select(
      "+passwordResetOtpHash +passwordResetOtpExpire +passwordResetOtpLastSentAt +passwordResetOtpAttempts"
    );

    // Generic message for invalid/expired code (avoid enumeration).
    const invalid = () =>
      res.status(400).json({
        success: false,
        message: "Invalid or expired verification code",
      });

    if (!user || !user.passwordResetOtpHash || !user.passwordResetOtpExpire) {
      return invalid();
    }

    const attempts = Number.isFinite(user.passwordResetOtpAttempts)
      ? user.passwordResetOtpAttempts
      : 0;

    if (attempts >= 5) {
      user.passwordResetOtpHash = null;
      user.passwordResetOtpExpire = null;
      user.passwordResetOtpAttempts = 0;
      await user.save({ validateBeforeSave: false });
      return invalid();
    }

    if (new Date(user.passwordResetOtpExpire).getTime() < Date.now()) {
      user.passwordResetOtpHash = null;
      user.passwordResetOtpExpire = null;
      user.passwordResetOtpAttempts = 0;
      await user.save({ validateBeforeSave: false });
      return invalid();
    }

    if (hashOtp(raw) !== user.passwordResetOtpHash) {
      user.passwordResetOtpAttempts = attempts + 1;
      await user.save({ validateBeforeSave: false });
      return invalid();
    }

    // OTP verified: clear OTP + issue short-lived reset token
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const resetTokenMinutes = Math.max(
      5,
      Number.parseInt(process.env.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES || "15", 10)
    );

    user.resetPasswordToken = tokenHash;
    user.resetPasswordExpire = new Date(Date.now() + resetTokenMinutes * 60 * 1000);
    user.passwordResetOtpHash = null;
    user.passwordResetOtpExpire = null;
    user.passwordResetOtpAttempts = 0;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      success: true,
      message: "Verification successful",
      resetToken: token,
      expiresInMinutes: resetTokenMinutes,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reset password using reset token
// @route   POST /api/auth/reset-password
// @access  Public
exports.resetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;
    const rawToken = String(token || "").trim();

    if (!rawToken) {
      return res.status(400).json({
        success: false,
        message: "Reset token is required",
      });
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    const user = await User.findOne({
      resetPasswordToken: tokenHash,
      resetPasswordExpire: { $gt: new Date() },
    }).select(
      "+password +passwordResetOtpHash +passwordResetOtpExpire +passwordResetOtpAttempts"
    );

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token",
      });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    user.passwordResetOtpHash = null;
    user.passwordResetOtpExpire = null;
    user.passwordResetOtpAttempts = 0;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password reset successful",
      email: user.email,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res, next) => {
  try {
    const { firstName, lastName, email, password, phone } = req.body;

    const normalizedEmail = String(email || "").toLowerCase().trim();
    const normalizedPhone = normalizePhone(phone);

    if (!isValidBdPhone(normalizedPhone)) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number",
      });
    }

    // Check if user exists
    const userExists = await User.findOne({ email: normalizedEmail });
    if (userExists) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this email",
      });
    }

    const phoneExists = await User.findOne({ phone: normalizedPhone });
    if (phoneExists) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this phone number",
      });
    }

    // Create user
    const user = await User.create({
      firstName,
      lastName,
      email: normalizedEmail,
      password,
      phone: normalizedPhone,
    });

    // Best-effort: link any prior guest orders by phone to this user.
    try {
      await linkOrdersToUserByPhone(user._id, user.phone);
    } catch {
      // Do not block registration
    }

    // Best-effort: link any prior guest notifications by phone to this user.
    try {
      await linkNotificationsToUserByPhone(user._id, user.phone);
    } catch {
      // Do not block registration
    }

    // Admin notification for new user registration
    try {
      if (user.role !== "admin") {
        await Notification.create({
          recipientType: "admin",
          type: "user",
          title: "New user registered",
          message: `New user registered: ${String(user.firstName || "").trim()} ${String(user.lastName || "").trim()} (${String(user.email || user.phone || "").trim()})`,
          referenceId: String(user._id),
          data: {
            userId: String(user._id),
            email: user.email,
            phone: user.phone,
            role: user.role,
          },
        });
      }
    } catch {
      // Best-effort only
    }

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validate email & password
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and password",
      });
    }

    // Normalize email (lowercase)
    const normalizedEmail = email.toLowerCase().trim();


    const user = await User.findOne({ email: normalizedEmail }).select("+password isBlocked");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: "Your account has been blocked. Please contact support.",
      });
    }

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Generate token
    const token = generateToken(user._id);

    // Best-effort: link any prior guest orders by phone to this user.
    try {
      await linkOrdersToUserByPhone(user._id, user.phone);
    } catch {
      // Do not block login
    }

    // Best-effort: link any prior guest notifications by phone to this user.
    try {
      await linkNotificationsToUserByPhone(user._id, user.phone);
    } catch {
      // Do not block login
    }

    // Admin notification for user login
    try {
      if (user.role !== "admin") {
        await Notification.create({
          recipientType: "admin",
          type: "user",
          title: "User logged in",
          message: `User logged in: ${String(user.firstName || "").trim()} ${String(user.lastName || "").trim()} (${String(user.email || user.phone || "").trim()})`,
          referenceId: String(user._id),
          data: {
            userId: String(user._id),
            email: user.email,
            phone: user.phone,
            role: user.role,
          },
        });
      }
    } catch {
      // Best-effort only
    }

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    next(error);
  }
};

const buildSmtpTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

const generateOtpCode = () => {
  return String(Math.floor(100000 + Math.random() * 900000));
};

const hashOtp = (code) => {
  return crypto.createHash("sha256").update(String(code || "")).digest("hex");
};

// @desc    Request email OTP for verification
// @route   POST /api/auth/email-otp/request
// @access  Private
exports.requestEmailOtp = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select(
      "+emailOtpHash +emailOtpExpire +emailOtpLastSentAt"
    );

    if (!user || !user.email) {
      return res.status(400).json({
        success: false,
        message: "Email is required for OTP verification",
      });
    }

    const last = user.emailOtpLastSentAt ? new Date(user.emailOtpLastSentAt).getTime() : 0;
    if (last && Date.now() - last < 60 * 1000) {
      return res.status(429).json({
        success: false,
        message: "Please wait before requesting another code",
      });
    }

    const code = generateOtpCode();
    const expiresMinutes = Math.max(2, Number.parseInt(process.env.EMAIL_OTP_EXPIRE_MINUTES || "10", 10));

    user.emailOtpHash = hashOtp(code);
    user.emailOtpExpire = new Date(Date.now() + expiresMinutes * 60 * 1000);
    user.emailOtpLastSentAt = new Date();
    await user.save({ validateBeforeSave: false });

    const transporter = buildSmtpTransporter();
    const mailOptions = {
      from: `"DeshWear" <${process.env.FROM_EMAIL || process.env.SMTP_USER}>`,
      to: user.email,
      subject: "Your verification code",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          <h2 style="margin: 0 0 12px 0;">Verification Code</h2>
          <p style="margin: 0 0 12px 0;">Use this code to verify your account:</p>
          <div style="font-size: 28px; font-weight: 800; letter-spacing: 6px; padding: 12px 16px; background:#f3f4f6; display:inline-block; border-radius: 10px;">${code}</div>
          <p style="margin: 16px 0 0 0; color:#6b7280; font-size: 12px;">This code expires in ${expiresMinutes} minutes.</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    return res.status(200).json({
      success: true,
      message: "Verification code sent",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify email OTP
// @route   POST /api/auth/email-otp/verify
// @access  Private
exports.verifyEmailOtp = async (req, res, next) => {
  try {
    const { code } = req.body;
    const raw = String(code || "").trim();

    if (!raw) {
      return res.status(400).json({
        success: false,
        message: "Verification code is required",
      });
    }

    const user = await User.findById(req.user.id).select(
      "+emailOtpHash +emailOtpExpire +emailOtpLastSentAt"
    );

    if (!user || !user.emailOtpHash || !user.emailOtpExpire) {
      return res.status(400).json({
        success: false,
        message: "No active verification code. Request a new one.",
      });
    }

    if (new Date(user.emailOtpExpire).getTime() < Date.now()) {
      user.emailOtpHash = null;
      user.emailOtpExpire = null;
      await user.save({ validateBeforeSave: false });
      return res.status(400).json({
        success: false,
        message: "Verification code expired. Request a new one.",
      });
    }

    if (hashOtp(raw) !== user.emailOtpHash) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code",
      });
    }

    user.isEmailVerified = true;
    user.emailOtpHash = null;
    user.emailOtpExpire = null;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      success: true,
      message: "Account verified successfully",
      user: {
        id: user._id,
        isEmailVerified: user.isEmailVerified,
      },
    });
  } catch (error) {
    next(error);
  }
};
