const Order = require("../models/Order");
const User = require("../models/User");
const AdvancePayment = require("../models/AdvancePayment");
const Notification = require("../models/Notification");
const { sendEmail, sendSms } = require("../services/notificationService");

const normalizePhone = (value) => {
    const digits = String(value || "").replace(/[^\d]/g, "");
    if (!digits) return "";
    if (digits.startsWith("8801") && digits.length === 13) {
        return `0${digits.slice(3)}`;
    }
    return digits;
};

const isValidBdPhone = (value) => /^01[3-9]\d{8}$/.test(normalizePhone(value));

const getDeliveryChargeForCity = (city) => {
    const normalized = String(city || "").trim().toLowerCase();
    if (normalized.includes("dhaka")) return 70;
    return 120;
};

exports.checkUserStatus = async (req, res, next) => {
    try {
        const { phone, townCity } = req.body;
        const customerPhone = normalizePhone(phone);

        if (!isValidBdPhone(customerPhone)) {
            return res.status(400).json({ success: false, message: "Valid customer phone is required" });
        }

        const cancelledOrderCount = await Order.countDocuments({
            $or: [
                { "shippingAddress.phone": customerPhone },
                { "guestInfo.phone": customerPhone },
            ],
            orderStatus: "cancelled",
        });

        const hasCancelledOrderHistory = cancelledOrderCount > 0;
        const pendingAdvance = hasCancelledOrderHistory
            ? await AdvancePayment.findOne({ customerPhone, status: "Pending" }).sort({ createdAt: -1 })
            : null;
        const approvedAdvance = hasCancelledOrderHistory
            ? await AdvancePayment.findOne({ customerPhone, status: "Approved", usedAt: null }).sort({ approvedAt: 1 })
            : null;

        const deliveryCharge = townCity ? getDeliveryChargeForCity(townCity) : null;

        return res.status(200).json({
            success: true,
            customerPhone,
            hasCancelledOrderHistory,
            advanceRequired: hasCancelledOrderHistory && !approvedAdvance,
            hasPendingAdvance: Boolean(pendingAdvance),
            approvedAdvance: approvedAdvance
                ? {
                    id: approvedAdvance._id,
                    amount: approvedAdvance.amount,
                    approvedAt: approvedAdvance.approvedAt,
                }
                : null,
            deliveryCharge,
            paymentNumber: "01995794410",
            supportedMethods: ["bkash", "nagad", "rocket", "upay"],
            message: hasCancelledOrderHistory
                ? approvedAdvance
                    ? "Advance payment already approved. You may place an order now."
                    : pendingAdvance
                        ? "You already have a pending advance payment request. Please wait until it is approved."
                        : "You have a cancelled order history. Advance delivery payment is required before placing a new order."
                : "No advance payment required.",
        });
    } catch (error) {
        next(error);
    }
};

exports.submitAdvanceRequest = async (req, res, next) => {
    try {
        const {
            customerPhone,
            townCity,
            paymentMethod,
            senderNumber,
            paidAmount,
            orderId,
        } = req.body;

        const normalizedPhone = normalizePhone(customerPhone);
        const normalizedSender = normalizePhone(senderNumber);

        if (!isValidBdPhone(normalizedPhone)) {
            return res.status(400).json({ success: false, message: "Customer phone must be a valid Bangladesh number" });
        }

        if (!isValidBdPhone(normalizedSender)) {
            return res.status(400).json({ success: false, message: "Sender mobile must be a valid Bangladesh number" });
        }

        if (!paymentMethod || !["bkash", "nagad", "rocket", "upay"].includes(String(paymentMethod).toLowerCase())) {
            return res.status(400).json({ success: false, message: "Invalid payment method" });
        }

        const autoGenTransactionId = `TRX-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const autoGenTrxIdLast4 = autoGenTransactionId.slice(-4);

        const paid = Number(paidAmount);
        if (!Number.isFinite(paid) || paid <= 0) {
            return res.status(400).json({ success: false, message: "Paid amount must be a positive number" });
        }

        const deliveryCharge = getDeliveryChargeForCity(townCity);
        if (paid < deliveryCharge) {
            return res.status(400).json({
                success: false,
                message: `Paid amount must be at least the delivery charge (${deliveryCharge})`,
            });
        }



        const existingPending = await AdvancePayment.findOne({ customerPhone: normalizedPhone, status: "Pending" });
        if (existingPending) {
            return res.status(409).json({
                success: false,
                message: "You already have a pending advance payment request. Please wait for approval.",
            });
        }

        const existingApproved = await AdvancePayment.findOne({
            customerPhone: normalizedPhone,
            status: "Approved",
            usedAt: null,
        });
        if (existingApproved) {
            return res.status(409).json({
                success: false,
                message: "An approved advance payment already exists for this phone number. You may place your order now.",
            });
        }

        const advancePayment = await AdvancePayment.create({
            orderId: orderId || null,
            userId: req.user ? req.user._id : null,
            customerPhone: normalizedPhone,
            paymentMethod: String(paymentMethod).toLowerCase(),
            senderNumber: normalizedSender,
            transactionId: autoGenTransactionId,
            trxIdLast4: autoGenTrxIdLast4,
            amount: paid,
            deliveryCharge,
            status: "Pending",
        });

        await Notification.create({
            recipientType: "admin",
            type: "advance_payment",
            title: "Advance Payment Request Submitted",
            message: `Advance payment submitted for ${normalizedPhone}. Amount: ৳${paid}.`,
            referenceId: String(advancePayment._id),
            data: {
                customerPhone: normalizedPhone,
                amount: paid,
                paymentMethod: String(paymentMethod).toLowerCase(),
                transactionId: autoGenTransactionId,
                orderId: orderId || null,
            },
        });

        return res.status(201).json({ success: true, advancePayment });
    } catch (error) {
        next(error);
    }
};

exports.getAdvancePayments = async (req, res, next) => {
    try {
        const payments = await AdvancePayment.find()
            .sort({ createdAt: -1 })
            .populate("userId", "firstName lastName email phone")
            .populate("approvedBy", "firstName lastName email")
            .populate("rejectedBy", "firstName lastName email");

        return res.status(200).json({ success: true, payments });
    } catch (error) {
        next(error);
    }
};

exports.approveAdvancePayment = async (req, res, next) => {
    try {
        const { id } = req.body;
        const payment = await AdvancePayment.findById(id);
        if (!payment) {
            return res.status(404).json({ success: false, message: "Advance payment not found" });
        }
        if (payment.status !== "Pending") {
            return res.status(400).json({ success: false, message: "Advance payment already processed" });
        }

        payment.status = "Approved";
        payment.approvedBy = req.user._id;
        payment.approvedAt = new Date();
        await payment.save();

        const userUpdate = {
            advanceVerified: true,
            advanceVerifiedAt: new Date(),
            advanceVerifiedBy: req.user._id,
        };

        if (payment.userId) {
            await User.findByIdAndUpdate(payment.userId, userUpdate);
        } else {
            await User.findOneAndUpdate({ phone: payment.customerPhone }, userUpdate);
        }

        if (payment.orderId) {
            await Order.findByIdAndUpdate(payment.orderId, {
                orderStatus: "pending",
                advancePaymentStatus: "Verified"
            });
        }

        return res.status(200).json({ success: true, payment });
    } catch (error) {
        next(error);
    }
};

exports.rejectAdvancePayment = async (req, res, next) => {
    try {
        const { id, reason } = req.body;
        const payment = await AdvancePayment.findById(id);
        if (!payment) {
            return res.status(404).json({ success: false, message: "Advance payment not found" });
        }
        if (payment.status !== "Pending") {
            return res.status(400).json({ success: false, message: "Advance payment already processed" });
        }

        payment.status = "Rejected";
        payment.rejectedBy = req.user._id;
        payment.rejectedAt = new Date();
        payment.rejectedReason = String(reason || "").trim();
        await payment.save();

        return res.status(200).json({ success: true, payment });
    } catch (error) {
        next(error);
    }
};

exports.editAdvancePayment = async (req, res, next) => {
    try {
        const { id, senderNumber, transactionId, trxIdLast4, paidAmount } = req.body;
        const payment = await AdvancePayment.findById(id);
        if (!payment) {
            return res.status(404).json({ success: false, message: "Advance payment not found" });
        }

        if (senderNumber) {
            const normalizedSender = normalizePhone(senderNumber);
            if (!isValidBdPhone(normalizedSender)) {
                return res.status(400).json({ success: false, message: "Sender mobile must be a valid Bangladesh number" });
            }
            payment.senderNumber = normalizedSender;
        }

        if (paidAmount !== undefined) {
            const paid = Number(paidAmount);
            if (!Number.isFinite(paid) || paid < 0) {
                return res.status(400).json({ success: false, message: "Paid amount must be a valid number" });
            }
            payment.amount = paid;
        }

        await payment.save();
        return res.status(200).json({ success: true, payment });
    } catch (error) {
        next(error);
    }
};
