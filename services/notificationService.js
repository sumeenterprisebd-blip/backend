const nodemailer = require("nodemailer");
const axios = require("axios");

const emailConfig = {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
};

const createTransporter = () => {
    if (!emailConfig.host || !emailConfig.auth.user || !emailConfig.auth.pass) {
        return null;
    }

    return nodemailer.createTransport(emailConfig);
};

const sendEmail = async (to, subject, html) => {
    const transporter = createTransporter();
    if (!transporter) {
        console.warn("Email config is not fully set. Skipping email notification.");
        return false;
    }

    const mailOptions = {
        from: process.env.FROM_EMAIL || emailConfig.auth.user,
        to,
        subject,
        html,
    };

    try {
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.warn("Failed to send email notification:", error?.message || error);
        return false;
    }
};

const sendSms = async (phone, message) => {
    const smsProviderUrl = String(process.env.SMS_PROVIDER_URL || "").trim();
    const smsApiKey = String(process.env.SMS_API_KEY || "").trim();
    const smsSender = String(process.env.SMS_SENDER || "DripDrop").trim();

    if (!smsProviderUrl || !smsApiKey) {
        console.warn("SMS config is not set. Skipping SMS notification.");
        return false;
    }

    try {
        await axios.post(
            smsProviderUrl,
            {
                apiKey: smsApiKey,
                to: phone,
                sender: smsSender,
                message,
            },
            {
                timeout: 10000,
                headers: {
                    "Content-Type": "application/json",
                },
            }
        );
        return true;
    } catch (error) {
        console.warn("Failed to send SMS notification:", error?.message || error);
        return false;
    }
};

module.exports = {
    sendEmail,
    sendSms,
};
