const Blacklist = require("../models/Blacklist");

const getBlockedMessage = () =>
    "Your order cannot be processed. Please contact support.";

// @desc    List blacklist entries
// @route   GET /api/blacklist
// @access  Admin
exports.getBlacklist = async (req, res, next) => {
    try {
        const type = String(req.query.type || "").trim().toLowerCase();
        const activeParam = String(req.query.active || "").trim().toLowerCase();

        const filter = {};
        if (type) filter.type = type;
        if (activeParam === "true") filter.active = true;
        if (activeParam === "false") filter.active = false;

        const entries = await Blacklist.find(filter)
            .sort({ createdAt: -1 })
            .limit(500);

        return res.status(200).json({
            success: true,
            entries,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Create blacklist entry
// @route   POST /api/blacklist
// @access  Admin
exports.createBlacklistEntry = async (req, res, next) => {
    try {
        const type = String(req.body?.type || "").trim().toLowerCase();
        const value = String(req.body?.value || "").trim();
        const reason = String(req.body?.reason || "").trim();

        if (!type || !["phone", "ip", "address"].includes(type)) {
            return res.status(400).json({
                success: false,
                message: "Invalid blacklist type",
            });
        }

        if (!value) {
            return res.status(400).json({
                success: false,
                message: "Value is required",
            });
        }

        const normalized = Blacklist.normalize(type, value);
        if (!normalized) {
            return res.status(400).json({
                success: false,
                message: "Invalid blacklist value",
            });
        }

        const entry = await Blacklist.create({
            type,
            value,
            normalized,
            reason,
            active: true,
            createdBy: req.user?._id || null,
        });

        return res.status(201).json({
            success: true,
            entry,
            message: "Added to blacklist",
        });
    } catch (error) {
        if (error?.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "Already blacklisted",
            });
        }
        next(error);
    }
};

// @desc    Remove blacklist entry
// @route   DELETE /api/blacklist/:id
// @access  Admin
exports.deleteBlacklistEntry = async (req, res, next) => {
    try {
        const entry = await Blacklist.findByIdAndDelete(req.params.id);

        if (!entry) {
            return res.status(404).json({
                success: false,
                message: "Blacklist entry not found",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Removed from blacklist",
        });
    } catch (error) {
        next(error);
    }
};

// Used by order creation (message centralization)
exports.getBlockedMessage = getBlockedMessage;
