const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
    {
        // Registered user (nullable for guest notifications)
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: false,
            index: true,
            default: null,
        },

        // Guest recipient (normalized local phone format like 01XXXXXXXXX)
        guestPhone: {
            type: String,
            trim: true,
            index: true,
            default: "",
        },

        // Optional order reference for easier filtering
        order: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Order",
            required: false,
            index: true,
            default: null,
        },
        recipientType: {
            type: String,
            enum: ["user", "guest", "admin"],
            default: "user",
            index: true,
        },
        referenceId: {
            type: String,
            trim: true,
            default: "",
            index: true,
        },
        type: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 140,
        },
        message: {
            type: String,
            required: true,
            trim: true,
            maxlength: 500,
        },
        data: {
            type: Object,
            default: {},
        },
        isRead: {
            type: Boolean,
            default: false,
            index: true,
        },
        readAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ guestPhone: 1, createdAt: -1 });
notificationSchema.index({ guestPhone: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ order: 1, createdAt: -1 });
notificationSchema.index({ recipientType: 1, createdAt: -1 });
notificationSchema.index({ referenceId: 1 });

module.exports = mongoose.model("Notification", notificationSchema);

