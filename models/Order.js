const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  image: {
    type: String,
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  size: {
    type: String,
    required: true,
  },
  color: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
});

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: Number,
      unique: true,
      index: true,
    },
    // Cached last-8 tracking code (e.g., used for guest tracking)
    shortId: {
      type: String,
      index: true,
      default: "",
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // Changed to false to support guest orders
    },
    isGuestOrder: {
      type: Boolean,
      default: false,
    },
    guestInfo: {
      email: String,
      phone: String,
    },

    // Guest Web Push subscriptions (browser subscriptions linked to this order + phone)
    guestPushSubscriptions: [
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
    orderItems: [orderItemSchema],
    shippingAddress: {
      firstName: String,
      lastName: String,
      email: String,
      phone: String,
      streetAddress: String,
      townCity: String,
      state: String,
      zipCode: String,
      country: String,
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "bkash", "card", "paypal", "sslcommerz", "nagad", "rocket", "upay"],
      default: "cash",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
    },
    paidAt: {
      type: Date,
      default: null,
    },
    paymentDetails: {
      provider: { type: String, default: "" },
      tranId: { type: String, default: "", index: true },
      valId: { type: String, default: "" },
      bankTranId: { type: String, default: "" },
      cardType: { type: String, default: "" },
      amount: { type: Number, default: 0 },
      currency: { type: String, default: "BDT" },
      initiatedAt: { type: Date, default: null },
      validatedAt: { type: Date, default: null },
      lastGatewayResponse: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    orderStatus: {
      type: String,
      enum: [
        "pending",
        "pending_approval",
        "PendingPayment",
        "confirmed",
        "processing",
        "hold",
        "shipped",
        "delivered",
        "paid_return",
        "cancelled",
      ],
      default: "pending",
    },
    advancePaymentRequired: {
      type: Boolean,
      default: false,
    },
    advancePaymentStatus: {
      type: String,
      enum: ["None", "Pending", "Verified", "Rejected"],
      default: "None",
    },
    advancePayment: {
      paymentMethod: { type: String, default: "" },
      senderNumber: { type: String, default: "" },
      transactionId: { type: String, default: "" },
      last4: { type: String, default: "" },
      rejectedReason: { type: String, default: "" },
      amount: { type: Number, default: 0 },
      paidAt: { type: Date, default: null },
    },
    totalAmount: {
      type: Number,
      default: 0,
    },
    advancePaid: {
      type: Number,
      default: 0,
    },
    dueAmount: {
      type: Number,
      default: 0,
    },
    // Pathao Integration Fields
    deliveryStatus: {
      type: String,
      enum: [
        "placed",
        "confirmed",
        "picked_up",
        "in_transit",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "failed",
      ],
      default: "placed",
    },
    pathaoConsignmentId: {
      type: String,
      default: null,
    },
    pathaoOrderId: {
      type: String,
      default: null,
    },
    trackingHistory: [
      {
        status: {
          type: String,
          required: true,
        },
        message: String,
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    lastStatusUpdate: {
      type: Date,
      default: Date.now,
    },
    subtotal: {
      type: Number,
      required: true,
    },
    discount: {
      type: Number,
      default: 0,
    },
    pricingVersion: {
      type: Number,
      default: 1,
    },
    deliveryFee: {
      type: Number,
      default: 15,
    },
    total: {
      type: Number,
      required: true,
    },
    pricingHistory: [
      {
        previous: {
          subtotal: { type: Number, default: 0 },
          discount: { type: Number, default: 0 },
          deliveryFee: { type: Number, default: 0 },
          total: { type: Number, default: 0 },
        },
        next: {
          subtotal: { type: Number, default: 0 },
          discount: { type: Number, default: 0 },
          deliveryFee: { type: Number, default: 0 },
          total: { type: Number, default: 0 },
        },
        reason: { type: String, default: "" },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
    notes: {
      type: String,
      default: "",
    },
    syncedToSheet: {
      type: Boolean,
      default: false,
    },
    syncedAt: {
      type: Date,
      default: null,
    },
    // Anti-fake-order / monitoring fields
    client: {
      ipAddress: { type: String, default: "" },
      userAgent: { type: String, default: "" },
      metaEventId: { type: String, default: "" },
      fbp: { type: String, default: "" },
      fbc: { type: String, default: "" },
    },
    orderFingerprint: {
      type: String,
      default: "",
      index: true,
    },
    riskScore: {
      type: Number,
      default: 0,
      index: true,
    },
    riskFlags: {
      type: [String],
      default: [],
      index: true,
    },
    isSuspicious: {
      type: Boolean,
      default: false,
      index: true,
    },
    requiresApproval: {
      type: Boolean,
      default: false,
      index: true,
    },
    approval: {
      status: {
        type: String,
        enum: ["none", "pending", "approved", "rejected"],
        default: "none",
        index: true,
      },
      approvedAt: { type: Date, default: null },
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      rejectedAt: { type: Date, default: null },
      rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      note: { type: String, default: "" },
    },
    whatsappLastSentAt: {
      type: Date,
      default: null,
    },
    deliveredAt: Date,
    cancelledAt: Date,
  },
  {
    timestamps: true,
  }
);

// Auto-generate sequential order number on create
orderSchema.pre("save", async function (next) {
  try {
    if (!this.shortId && this._id) {
      this.shortId = this._id.toString().slice(-8).toUpperCase();
    }
    if (this.isNew && !this.orderNumber) {
      const Counter = require("./Counter");
      this.orderNumber = await Counter.getNextSequence("orderNumber");
    }
    next();
  } catch (error) {
    next(error);
  }
});

// Index for user orders
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ requiresApproval: 1, "approval.status": 1, createdAt: -1 });
orderSchema.index({ shortId: 1 });
orderSchema.index({ "shippingAddress.phone": 1, createdAt: -1 });
orderSchema.index({ "guestInfo.phone": 1, createdAt: -1 });
orderSchema.index({ "guestPushSubscriptions.endpoint": 1 });

module.exports = mongoose.model("Order", orderSchema);
