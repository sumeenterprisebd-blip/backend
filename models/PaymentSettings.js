const mongoose = require("mongoose");

const paymentSettingsSchema = new mongoose.Schema(
    {
        sslcommerz: {
            enabled: { type: Boolean, default: false },
            sandbox: { type: Boolean, default: true },
            storeId: { type: String, default: "" },
            storePasswordEnc: { type: String, default: "" },
            lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        },
        advancePayment: {
            paymentNumber: { type: String, default: "01995794410" },
            supportedMethods: {
                type: [String],
                default: ["bkash", "nagad", "rocket", "upay"],
            },
        },
        deliveryCharges: {
            insideDhaka: { type: Number, default: 70 },
            outsideDhaka: { type: Number, default: 120 },
        },
    },
    { timestamps: true }
);

paymentSettingsSchema.statics.getSettings = async function () {
    let settings = await this.findOne();
    if (!settings) {
        settings = await this.create({});
    }
    return settings;
};

module.exports = mongoose.model("PaymentSettings", paymentSettingsSchema);
