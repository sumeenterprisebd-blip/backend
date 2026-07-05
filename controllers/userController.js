// @desc    Block or unblock a user (Admin only)
// @route   PUT /api/users/:id/block
// @access  Private/Admin
exports.blockUser = async (req, res, next) => {
  try {
    const { block } = req.body;
    const UserModel = require("../models/User");
    const userId = req.params.id;

    if (userId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: "You cannot block your own account",
      });
    }

    const user = await UserModel.findByIdAndUpdate(
      userId,
      {
        isBlocked: !!block,
        status: block ? "blocked" : "active",
      },
      { new: true, runValidators: true }
    ).select("-password");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.status(200).json({ success: true, message: block ? "User blocked" : "User unblocked", user });
  } catch (error) {
    next(error);
  }
};
// @desc    Verify user email (Admin only)
// @route   PUT /api/users/:id/verify
// @access  Private/Admin
exports.verifyUserEmail = async (req, res, next) => {
  try {
    const verified = typeof req.body?.verified === "boolean" ? req.body.verified : true;
    const UserModel = require("../models/User");
    const user = await UserModel.findByIdAndUpdate(
      req.params.id,
      { isEmailVerified: verified },
      { new: true, runValidators: true }
    ).select("-password");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.status(200).json({
      success: true,
      message: verified ? "User email verified" : "User email verification revoked",
      user,
    });
  } catch (error) {
    next(error);
  }
};
const User = require("../models/User");
const Order = require("../models/Order");

const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseBool = (value) => {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return undefined;
};

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
exports.getProfile = async (req, res, next) => {
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

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
exports.updateProfile = async (req, res, next) => {
  try {
    const fieldsToUpdate = {};
    if (req.body.firstName) fieldsToUpdate.firstName = req.body.firstName;
    if (req.body.lastName) fieldsToUpdate.lastName = req.body.lastName;
    if (req.body.phone) fieldsToUpdate.phone = req.body.phone;
    if (req.body.avatar) fieldsToUpdate.avatar = req.body.avatar;

    const user = await User.findByIdAndUpdate(req.user.id, fieldsToUpdate, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add address
// @route   POST /api/users/addresses
// @access  Private
exports.addAddress = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

    // If this is the first address or isDefault is true, set others to false
    if (req.body.isDefault || user.addresses.length === 0) {
      user.addresses.forEach((addr) => {
        addr.isDefault = false;
      });
      req.body.isDefault = true;
    }

    user.addresses.push(req.body);
    await user.save();

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update address
// @route   PUT /api/users/addresses/:addressId
// @access  Private
exports.updateAddress = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    const address = user.addresses.id(req.params.addressId);

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found",
      });
    }

    // If setting as default, unset others
    if (req.body.isDefault) {
      user.addresses.forEach((addr) => {
        addr.isDefault = false;
      });
    }

    Object.assign(address, req.body);
    await user.save();

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete address
// @route   DELETE /api/users/addresses/:addressId
// @access  Private
exports.deleteAddress = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    user.addresses = user.addresses.filter(
      (addr) => addr._id.toString() !== req.params.addressId
    );
    await user.save();

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all users (Admin only)
// @route   GET /api/users
// @access  Private/Admin
exports.getAllUsers = async (req, res, next) => {
  try {
    const {
      q,
      role,
      status,
      suspicious,
      emailVerified,
      phoneVerified,
      registeredFrom,
      registeredTo,
      hasOrders,
      minOrders,
      maxOrders,
      sort = "createdAt",
      order = "desc",
      page = 1,
      limit = 20,
    } = req.query;

    const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
    const limitNumRaw = Number.parseInt(limit, 10);
    const limitNum = Math.min(100, Math.max(1, Number.isFinite(limitNumRaw) ? limitNumRaw : 20));
    const skip = (pageNum - 1) * limitNum;

    const match = {};

    if (role && role !== "all") match.role = role;
    if (status && status !== "all") match.status = status;

    const suspiciousBool = parseBool(suspicious);
    if (typeof suspiciousBool === "boolean") match.isSuspicious = suspiciousBool;

    const emailVerifiedBool = parseBool(emailVerified);
    if (typeof emailVerifiedBool === "boolean") match.isEmailVerified = emailVerifiedBool;

    const phoneVerifiedBool = parseBool(phoneVerified);
    if (typeof phoneVerifiedBool === "boolean") match.isPhoneVerified = phoneVerifiedBool;

    if (registeredFrom || registeredTo) {
      match.createdAt = {};
      if (registeredFrom) {
        const from = new Date(registeredFrom);
        if (!Number.isNaN(from.getTime())) match.createdAt.$gte = from;
      }
      if (registeredTo) {
        const to = new Date(registeredTo);
        if (!Number.isNaN(to.getTime())) match.createdAt.$lte = to;
      }
      if (Object.keys(match.createdAt).length === 0) delete match.createdAt;
    }

    if (q && String(q).trim()) {
      const safe = escapeRegex(String(q).trim());
      const re = new RegExp(safe, "i");
      match.$or = [
        { firstName: re },
        { lastName: re },
        { email: re },
        { phone: re },
      ];
    }

    const orderCountFilters = [];
    const hasOrdersBool = parseBool(hasOrders);
    if (typeof hasOrdersBool === "boolean") {
      orderCountFilters.push({
        $match: hasOrdersBool ? { orderCount: { $gt: 0 } } : { orderCount: 0 },
      });
    }
    const minOrdersNum = minOrders !== undefined ? Number.parseInt(minOrders, 10) : undefined;
    const maxOrdersNum = maxOrders !== undefined ? Number.parseInt(maxOrders, 10) : undefined;
    if (Number.isFinite(minOrdersNum)) {
      orderCountFilters.push({ $match: { orderCount: { $gte: minOrdersNum } } });
    }
    if (Number.isFinite(maxOrdersNum)) {
      orderCountFilters.push({ $match: { orderCount: { $lte: maxOrdersNum } } });
    }

    const sortDir = order === "asc" ? 1 : -1;
    const allowedSorts = new Set(["createdAt", "lastOrderAt", "orderCount"]);
    const sortKey = allowedSorts.has(sort) ? sort : "createdAt";
    const sortStage = { $sort: { [sortKey]: sortDir, createdAt: -1 } };

    const basePipeline = [
      { $match: match },
      {
        $lookup: {
          from: "orders",
          let: { userId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$user", "$$userId"] } } },
            {
              $group: {
                _id: null,
                orderCount: { $sum: 1 },
                lastOrderAt: { $max: "$createdAt" },
              },
            },
          ],
          as: "orderStats",
        },
      },
      {
        $addFields: {
          orderCount: {
            $ifNull: [{ $arrayElemAt: ["$orderStats.orderCount", 0] }, 0],
          },
          lastOrderAt: { $arrayElemAt: ["$orderStats.lastOrderAt", 0] },
        },
      },
      ...orderCountFilters,
      {
        $project: {
          password: 0,
          resetPasswordToken: 0,
          resetPasswordExpire: 0,
          orderStats: 0,
        },
      },
    ];

    const pipeline = [
      ...basePipeline,
      {
        $facet: {
          data: [sortStage, { $skip: skip }, { $limit: limitNum }],
          meta: [{ $count: "total" }],
          summary: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                admins: {
                  $sum: { $cond: [{ $eq: ["$role", "admin"] }, 1, 0] },
                },
                moderators: {
                  $sum: { $cond: [{ $eq: ["$role", "moderator"] }, 1, 0] },
                },
                regular: {
                  $sum: { $cond: [{ $eq: ["$role", "user"] }, 1, 0] },
                },
                active: {
                  $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
                },
                suspended: {
                  $sum: { $cond: [{ $eq: ["$status", "suspended"] }, 1, 0] },
                },
                blocked: {
                  $sum: { $cond: [{ $eq: ["$status", "blocked"] }, 1, 0] },
                },
                suspicious: {
                  $sum: { $cond: ["$isSuspicious", 1, 0] },
                },
                emailUnverified: {
                  $sum: { $cond: [{ $eq: ["$isEmailVerified", false] }, 1, 0] },
                },
                phoneUnverified: {
                  $sum: { $cond: [{ $eq: ["$isPhoneVerified", false] }, 1, 0] },
                },
              },
            },
          ],
        },
      },
    ];

    const result = await User.aggregate(pipeline).allowDiskUse(true);
    const first = result?.[0] || {};
    const users = first.data || [];
    const total = first.meta?.[0]?.total || 0;
    const summary = first.summary?.[0] || {
      total: 0,
      admins: 0,
      moderators: 0,
      regular: 0,
      active: 0,
      suspended: 0,
      blocked: 0,
      suspicious: 0,
      emailUnverified: 0,
      phoneUnverified: 0,
    };

    res.status(200).json({
      success: true,
      users,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
      },
      summary,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update user status (Active/Suspended/Blocked)
// @route   PUT /api/users/:id/status
// @access  Private/Admin
exports.updateUserStatus = async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { status } = req.body;

    if (userId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: "You cannot change your own account status",
      });
    }

    const allowed = new Set(["active", "suspended", "blocked"]);
    if (!allowed.has(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    const updates = {
      status,
      isBlocked: status === "blocked",
    };

    const user = await User.findByIdAndUpdate(userId, updates, {
      new: true,
      runValidators: true,
    }).select("-password");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      message: "User status updated",
      user,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark/unmark a user as suspicious
// @route   PUT /api/users/:id/suspicious
// @access  Private/Admin
exports.setUserSuspicious = async (req, res, next) => {
  try {
    const userId = req.params.id;
    const suspicious = !!req.body.suspicious;
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
    const tags = Array.isArray(req.body.tags)
      ? req.body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20)
      : [];

    if (userId === req.user.id && suspicious) {
      return res.status(400).json({
        success: false,
        message: "You cannot mark your own account as suspicious",
      });
    }

    const updates = {
      isSuspicious: suspicious,
      suspiciousReason: suspicious ? reason : "",
      suspiciousTags: suspicious ? tags : [],
      suspiciousMarkedAt: suspicious ? new Date() : null,
      suspiciousMarkedBy: suspicious ? req.user.id : null,
    };

    const user = await User.findByIdAndUpdate(userId, updates, {
      new: true,
      runValidators: true,
    }).select("-password");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      message: suspicious ? "User marked as suspicious" : "User unmarked as suspicious",
      user,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify user phone (Admin only)
// @route   PUT /api/users/:id/verify-phone
// @access  Private/Admin
exports.verifyUserPhone = async (req, res, next) => {
  try {
    const verified = typeof req.body?.verified === "boolean" ? req.body.verified : true;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isPhoneVerified: verified },
      { new: true, runValidators: true }
    ).select("-password");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.status(200).json({
      success: true,
      message: verified ? "User phone verified" : "User phone verification revoked",
      user,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get a user's order history (Admin)
// @route   GET /api/users/:id/orders
// @access  Private/Admin
exports.getUserOrders = async (req, res, next) => {
  try {
    const userId = req.params.id;
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limitRaw = Number.parseInt(req.query.limit, 10);
    const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20));
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find({ user: userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("orderNumber orderStatus paymentStatus total createdAt updatedAt")
        .lean(),
      Order.countDocuments({ user: userId }),
    ]);

    res.status(200).json({
      success: true,
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Detect duplicate phone/email across users (Admin)
// @route   GET /api/users/duplicates
// @access  Private/Admin
exports.getDuplicateUsers = async (req, res, next) => {
  try {
    const [phoneDuplicates, emailDuplicates] = await Promise.all([
      User.aggregate([
        { $match: { phone: { $exists: true, $ne: "" } } },
        {
          $group: {
            _id: "$phone",
            count: { $sum: 1 },
            users: {
              $push: {
                _id: "$_id",
                firstName: "$firstName",
                lastName: "$lastName",
                email: "$email",
                status: "$status",
                isSuspicious: "$isSuspicious",
              },
            },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 100 },
      ]),
      User.aggregate([
        { $match: { email: { $exists: true, $ne: "" } } },
        {
          $group: {
            _id: "$email",
            count: { $sum: 1 },
            users: {
              $push: {
                _id: "$_id",
                firstName: "$firstName",
                lastName: "$lastName",
                phone: "$phone",
                status: "$status",
                isSuspicious: "$isSuspicious",
              },
            },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 100 },
      ]),
    ]);

    res.status(200).json({
      success: true,
      duplicates: {
        phones: phoneDuplicates,
        emails: emailDuplicates,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update user role (Admin only)
// @route   PUT /api/users/:id/role
// @access  Private/Admin
exports.updateUserRole = async (req, res, next) => {
  try {
    const { role } = req.body;
    const userId = req.params.id;

    // Prevent admin from changing their own role
    if (userId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: "You cannot change your own role",
      });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { role },
      { new: true, runValidators: true }
    ).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete user (Admin only)
// @route   DELETE /api/users/:id
// @access  Private/Admin
exports.deleteUser = async (req, res, next) => {
  try {
    const userId = req.params.id;

    // Prevent admin from deleting their own account
    if (userId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own account",
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    await User.findByIdAndDelete(userId);

    res.status(200).json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
