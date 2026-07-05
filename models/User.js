const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true
  },
  lastName: {
    type: String,
    trim: true,
    default: ''
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: function () {
      return true;
    },
    minlength: [6, 'Password must be at least 6 characters'],
    select: false
  },
  phone: {
    type: String,
    trim: true
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  isPhoneVerified: {
    type: Boolean,
    default: false
  },
  avatar: {
    type: String,
    default: null
  },
  addresses: [{
    streetAddress: String,
    townCity: String,
    state: String,
    zipCode: String,
    country: String,
    isDefault: {
      type: Boolean,
      default: false
    }
  }],
  role: {
    type: String,
    enum: ['user', 'moderator', 'admin'],
    default: 'user'
  },
  status: {
    type: String,
    enum: ['active', 'suspended', 'blocked'],
    default: 'active'
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  isBlockedForCOD: {
    type: Boolean,
    default: false,
    index: true,
  },
  blockedForCODAt: {
    type: Date,
    default: null,
  },
  advanceVerified: {
    type: Boolean,
    default: false,
    index: true,
  },
  advanceVerifiedAt: {
    type: Date,
    default: null,
  },
  advanceVerifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  isSuspicious: {
    type: Boolean,
    default: false
  },
  suspiciousReason: {
    type: String,
    trim: true,
    default: ''
  },
  suspiciousTags: {
    type: [String],
    default: []
  },
  suspiciousMarkedAt: {
    type: Date,
    default: null
  },
  suspiciousMarkedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  resetPasswordToken: String,
  resetPasswordExpire: Date,

  // Password reset OTP (short-lived)
  passwordResetOtpHash: {
    type: String,
    default: null,
    select: false,
  },
  passwordResetOtpExpire: {
    type: Date,
    default: null,
    select: false,
  },
  passwordResetOtpLastSentAt: {
    type: Date,
    default: null,
    select: false,
  },
  passwordResetOtpAttempts: {
    type: Number,
    default: 0,
    select: false,
  },

  // Email OTP verification (short-lived)
  emailOtpHash: {
    type: String,
    default: null,
    select: false,
  },
  emailOtpExpire: {
    type: Date,
    default: null,
    select: false,
  },
  emailOtpLastSentAt: {
    type: Date,
    default: null,
    select: false,
  },

  // Web Push subscriptions (for customer notifications)
  pushSubscriptions: [
    {
      endpoint: { type: String, trim: true },
      expirationTime: { type: Number, default: null },
      keys: {
        p256dh: { type: String, trim: true },
        auth: { type: String, trim: true },
      },
      userAgent: { type: String, trim: true, default: "" },
      createdAt: { type: Date, default: null },
      lastUsedAt: { type: Date, default: null },
    },
  ],
}, {
  timestamps: true
});

userSchema.index({ phone: 1 });
userSchema.index({ status: 1, role: 1, createdAt: -1 });
userSchema.index({ isSuspicious: 1, createdAt: -1 });
userSchema.index({ "pushSubscriptions.endpoint": 1 });

// Hash password before saving (only if password is provided)
userSchema.pre('save', async function (next) {
  // Skip password hashing if user is using OAuth (no password) or password not modified
  if (!this.isModified('password') || !this.password) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Generate and set password reset token
userSchema.methods.generatePasswordReset = function () {
  const token = crypto.randomBytes(20).toString('hex');
  this.resetPasswordToken = crypto.createHash('sha256').update(token).digest('hex');
  // Token valid for 1 hour
  this.resetPasswordExpire = Date.now() + 60 * 60 * 1000;
  return token;
};

// Clear password reset token
userSchema.methods.clearPasswordReset = function () {
  this.resetPasswordToken = undefined;
  this.resetPasswordExpire = undefined;
};

// Compare password method
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);


