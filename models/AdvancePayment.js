const mongoose = require("mongoose");

const advancePaymentSchema = new mongoose.Schema(
    {
        orderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Order",
            default: null,
            index: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
            index: true,
        },
        customerPhone: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        paymentMethod: {
            type: String,
            enum: ["bkash", "nagad", "rocket", "upay"],
            required: true,
            trim: true,
        },
        senderNumber: {
            type: String,
            required: true,
            trim: true,
        },
        
        amount: {
            type: Number,
            required: true,
            min: 0,
        },
        deliveryCharge: {
            type: Number,
            required: true,
            min: 0,
        },
        status: {
            type: String,
            enum: ["Pending", "Approved", "Rejected"],
            default: "Pending",
        },
        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        approvedAt: {
            type: Date,
            default: null,
        },
        rejectedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        rejectedAt: {
            type: Date,
            default: null,
        },
        rejectedReason: {
            type: String,
            trim: true,
            default: null,
        },
        usedAt: {
            type: Date,
            default: null,
        },
        usedForOrderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Order",
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("AdvancePayment", advancePaymentSchema);
