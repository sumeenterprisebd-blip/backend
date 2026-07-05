const Order = require("../models/Order");
const User = require("../models/User");
const Product = require("../models/Product");

const parseIntEnv = (name, fallback) => {
    const raw = process.env[name];
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const startOfToday = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const getDateRange = (range) => {
    const now = new Date();
    const today = startOfToday();

    switch (range) {
        case "today":
            return { start: today, end: now };
        case "week": {
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - 7);
            return { start: weekStart, end: now };
        }
        case "month": {
            const monthStart = new Date(today);
            monthStart.setMonth(today.getMonth() - 1);
            return { start: monthStart, end: now };
        }
        default:
            return { start: null, end: null };
    }
};

const getPreviousPeriodRange = (currentRange) => {
    const today = startOfToday();

    switch (currentRange) {
        case "today": {
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            return { start: yesterday, end: today };
        }
        case "week": {
            const prevWeekStart = new Date(today);
            prevWeekStart.setDate(today.getDate() - 14);
            const prevWeekEnd = new Date(today);
            prevWeekEnd.setDate(today.getDate() - 7);
            return { start: prevWeekStart, end: prevWeekEnd };
        }
        case "month": {
            const prevMonthStart = new Date(today);
            prevMonthStart.setMonth(today.getMonth() - 2);
            const prevMonthEnd = new Date(today);
            prevMonthEnd.setMonth(today.getMonth() - 1);
            return { start: prevMonthStart, end: prevMonthEnd };
        }
        default:
            return { start: null, end: null };
    }
};

const percentChange = (current, previous) => {
    const cur = Number(current || 0);
    const prev = Number(previous || 0);
    if (!prev) return cur > 0 ? 100 : 0;
    return ((cur - prev) / prev) * 100;
};

const CANCELLED_STATUSES = ["cancelled", "paid_return"];
const SUCCESS_STATUSES = ["delivered"]; // currently the only "successful" status in this app

const getOrderStats = async (match) => {
    const rows = await Order.aggregate([
        { $match: match },
        {
            $group: {
                _id: null,
                totalOrders: { $sum: 1 },
                grossRevenue: { $sum: "$total" },
                deliveredRevenue: {
                    $sum: {
                        $cond: [{ $in: ["$orderStatus", SUCCESS_STATUSES] }, "$total", 0],
                    },
                },
                cancelledRevenue: {
                    $sum: {
                        $cond: [{ $in: ["$orderStatus", CANCELLED_STATUSES] }, "$total", 0],
                    },
                },
                averageOrderValue: { $avg: "$total" },
                pendingOrders: {
                    $sum: {
                        $cond: [
                            { $in: ["$orderStatus", ["pending", "confirmed", "hold"]] },
                            1,
                            0,
                        ],
                    },
                },
                processingOrders: {
                    $sum: {
                        $cond: [
                            { $in: ["$orderStatus", ["processing", "shipped"]] },
                            1,
                            0,
                        ],
                    },
                },
                completedOrders: {
                    $sum: { $cond: [{ $in: ["$orderStatus", SUCCESS_STATUSES] }, 1, 0] },
                },
                cancelledOrders: {
                    $sum: {
                        $cond: [
                            { $in: ["$orderStatus", CANCELLED_STATUSES] },
                            1,
                            0,
                        ],
                    },
                },
            },
        },
    ]);

    const base = rows && rows[0] ? rows[0] : {};

    const deliveredRevenue = Number(base.deliveredRevenue || 0);
    const cancelledRevenue = Number(base.cancelledRevenue || 0);
    const netRevenue = deliveredRevenue - cancelledRevenue;

    return {
        totalOrders: Number(base.totalOrders || 0),
        // Keep the legacy field name but redefine it to mean *net* revenue:
        //   delivered sales minus cancelled/returned (paid_return) sales.
        // This matches the dashboard requirement: cancelled orders must reduce revenue.
        totalRevenue: netRevenue,
        grossRevenue: Number(base.grossRevenue || 0),
        netRevenue,
        deliveredRevenue,
        cancelledRevenue,
        averageOrderValue: Number(base.averageOrderValue || 0),
        pendingOrders: Number(base.pendingOrders || 0),
        processingOrders: Number(base.processingOrders || 0),
        completedOrders: Number(base.completedOrders || 0),
        cancelledOrders: Number(base.cancelledOrders || 0),
    };
};

const getSalesSummary = async () => {
    const now = new Date();
    const ranges = {
        today: getDateRange("today"),
        week: getDateRange("week"),
        month: getDateRange("month"),
    };

    const keys = Object.keys(ranges);
    const rows = await Promise.all(
        keys.map((key) => {
            const { start, end } = ranges[key] || {};
            if (!start || !end) {
                return Promise.resolve({ key, deliveredRevenue: 0, cancelledRevenue: 0 });
            }

            return Order.aggregate([
                { $match: { createdAt: { $gte: start, $lte: end } } },
                {
                    $group: {
                        _id: null,
                        deliveredRevenue: {
                            $sum: {
                                $cond: [{ $in: ["$orderStatus", SUCCESS_STATUSES] }, "$total", 0],
                            },
                        },
                        cancelledRevenue: {
                            $sum: {
                                $cond: [{ $in: ["$orderStatus", CANCELLED_STATUSES] }, "$total", 0],
                            },
                        },
                    },
                },
            ]).then((agg) => {
                const first = Array.isArray(agg) && agg[0] ? agg[0] : {};
                return {
                    key,
                    deliveredRevenue: Number(first.deliveredRevenue || 0),
                    cancelledRevenue: Number(first.cancelledRevenue || 0),
                };
            });
        })
    );

    const summary = {};
    for (const row of rows) {
        const deliveredRevenue = Number(row.deliveredRevenue || 0);
        const cancelledRevenue = Number(row.cancelledRevenue || 0);
        summary[row.key] = {
            deliveredRevenue,
            cancelledRevenue,
            netRevenue: deliveredRevenue - cancelledRevenue,
            start: ranges[row.key]?.start ? ranges[row.key].start.toISOString() : null,
            end: ranges[row.key]?.end ? ranges[row.key].end.toISOString() : now.toISOString(),
        };
    }

    return summary;
};

// @desc    Admin analytics (server-side aggregated)
// @route   GET /api/admin/analytics?timeRange=all|today|week|month
// @access  Private/Admin
exports.getAdminAnalytics = async (req, res, next) => {
    try {
        const timeRange = String(req.query.timeRange || "all");

        const { start, end } = getDateRange(timeRange);
        const dateMatch = start && end ? { createdAt: { $gte: start, $lte: end } } : {};

        const { start: prevStart, end: prevEnd } = getPreviousPeriodRange(timeRange);
        const prevDateMatch =
            prevStart && prevEnd ? { createdAt: { $gte: prevStart, $lte: prevEnd } } : {};

        const approvalThreshold = Math.max(0, parseIntEnv("ORDER_RISK_APPROVAL_THRESHOLD", 50));
        const lowStockThreshold = Math.max(1, parseIntEnv("LOW_STOCK_THRESHOLD", 10));

        const [
            totalUsers,
            totalProducts,
            activeCustomers,
            currentNewUsers,
            previousNewUsers,
            currentOrderStats,
            previousOrderStats,
            salesSummary,
            chartRows,
            newUsersChartRows,
            recentOrders,
            topProducts,
            lowStockProducts,
            approvalPendingCount,
            approvalPendingOrders,
            riskyOrdersCount,
            riskFlagBreakdown,
            suspiciousUsers,
            unverifiedEmailUsers,
            unverifiedPhoneUsers,
            blockedUsers,
            suspendedUsers,
        ] = await Promise.all([
            User.countDocuments(),
            Product.countDocuments(),
            Order.distinct("user", { ...dateMatch, user: { $ne: null } }).then((ids) => (Array.isArray(ids) ? ids.length : 0)),
            start && end ? User.countDocuments({ createdAt: { $gte: start, $lte: end } }) : 0,
            prevStart && prevEnd ? User.countDocuments({ createdAt: { $gte: prevStart, $lte: prevEnd } }) : 0,
            getOrderStats(dateMatch),
            getOrderStats(prevDateMatch),
            getSalesSummary(),
            Order.aggregate([
                { $match: dateMatch },
                {
                    $group: {
                        _id: {
                            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
                        },
                        deliveredRevenue: {
                            $sum: {
                                $cond: [{ $in: ["$orderStatus", SUCCESS_STATUSES] }, "$total", 0],
                            },
                        },
                        cancelledRevenue: {
                            $sum: {
                                $cond: [{ $in: ["$orderStatus", CANCELLED_STATUSES] }, "$total", 0],
                            },
                        },
                        orders: { $sum: 1 },
                    },
                },
                {
                    $addFields: {
                        revenue: { $subtract: ["$deliveredRevenue", "$cancelledRevenue"] },
                    },
                },
                { $sort: { _id: 1 } },
            ]),
            User.aggregate([
                { $match: start && end ? { createdAt: { $gte: start, $lte: end } } : {} },
                {
                    $group: {
                        _id: {
                            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
                        },
                        users: { $sum: 1 },
                    },
                },
                { $sort: { _id: 1 } },
            ]),
            Order.find(dateMatch)
                .sort({ createdAt: -1 })
                .limit(10)
                .select("orderNumber shippingAddress total orderStatus createdAt user riskScore riskFlags requiresApproval approval")
                .populate("user", "email"),
            Order.aggregate([
                { $match: dateMatch },
                { $unwind: "$orderItems" },
                {
                    $group: {
                        _id: "$orderItems.product",
                        name: { $first: "$orderItems.name" },
                        image: { $first: "$orderItems.image" },
                        totalQuantity: { $sum: "$orderItems.quantity" },
                        totalRevenue: {
                            $sum: {
                                $multiply: ["$orderItems.price", "$orderItems.quantity"],
                            },
                        },
                    },
                },
                { $sort: { totalQuantity: -1 } },
                { $limit: 10 },
            ]),
            Product.countDocuments({ stock: { $lt: lowStockThreshold } }),
            Order.countDocuments({
                ...dateMatch,
                requiresApproval: true,
                "approval.status": "pending",
            }),
            Order.find({
                ...dateMatch,
                requiresApproval: true,
                "approval.status": "pending",
            })
                .sort({ createdAt: -1 })
                .limit(10)
                .select(
                    "orderNumber shippingAddress total orderStatus createdAt user riskScore riskFlags requiresApproval approval"
                )
                .populate("user", "email phone isEmailVerified isPhoneVerified"),
            Order.countDocuments({
                ...dateMatch,
                riskScore: { $gte: approvalThreshold },
            }),
            Order.aggregate([
                { $match: { ...dateMatch, riskFlags: { $exists: true, $ne: [] } } },
                { $unwind: "$riskFlags" },
                { $group: { _id: "$riskFlags", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 8 },
            ]),
            User.countDocuments({ isSuspicious: true }),
            User.countDocuments({ isEmailVerified: { $ne: true } }),
            User.countDocuments({ phone: { $exists: true, $ne: "" }, isPhoneVerified: { $ne: true } }),
            User.countDocuments({ status: "blocked" }),
            User.countDocuments({ status: "suspended" }),
        ]);

        const labels = chartRows.map((r) => r._id);
        const revenueData = chartRows.map((r) => Number(r.revenue || 0));
        const ordersData = chartRows.map((r) => Number(r.orders || 0));

        const newUsersLabels = (Array.isArray(newUsersChartRows) ? newUsersChartRows : []).map((r) => r._id);
        const usersData = (Array.isArray(newUsersChartRows) ? newUsersChartRows : []).map((r) => Number(r.users || 0));

        const revenueChange = timeRange === "all" ? 0 : percentChange(currentOrderStats.totalRevenue, previousOrderStats.totalRevenue);
        const ordersChange = timeRange === "all" ? 0 : percentChange(currentOrderStats.totalOrders, previousOrderStats.totalOrders);
        const usersChange = timeRange === "all" ? 0 : percentChange(currentNewUsers, previousNewUsers);
        const avgOrderValueChange = timeRange === "all" ? 0 : percentChange(currentOrderStats.averageOrderValue, previousOrderStats.averageOrderValue);

        res.status(200).json({
            success: true,
            timeRange,
            generatedAt: new Date().toISOString(),
            range: {
                start: start ? start.toISOString() : null,
                end: end ? end.toISOString() : null,
            },
            stats: {
                ...currentOrderStats,
                totalUsers: Number(totalUsers || 0),
                totalProducts: Number(totalProducts || 0),
                activeCustomers: Number(activeCustomers || 0),
                newUsers: Number(currentNewUsers || 0),
                salesSummary: salesSummary || {},
                // Convenience fields for the Admin Dashboard Overview.
                salesToday: Number(salesSummary?.today?.netRevenue || 0),
                salesWeek: Number(salesSummary?.week?.netRevenue || 0),
                salesMonth: Number(salesSummary?.month?.netRevenue || 0),
                revenueChange,
                ordersChange,
                usersChange,
                avgOrderValueChange,
                conversionRate: 0,
            },
            security: {
                approvalThreshold,
                approvalPendingCount: Number(approvalPendingCount || 0),
                approvalPendingOrders: Array.isArray(approvalPendingOrders) ? approvalPendingOrders : [],
                riskyOrdersCount: Number(riskyOrdersCount || 0),
                riskFlagBreakdown: Array.isArray(riskFlagBreakdown)
                    ? riskFlagBreakdown.map((r) => ({ flag: r._id, count: Number(r.count || 0) }))
                    : [],
                suspiciousUsers: Number(suspiciousUsers || 0),
                unverifiedEmailUsers: Number(unverifiedEmailUsers || 0),
                unverifiedPhoneUsers: Number(unverifiedPhoneUsers || 0),
                blockedUsers: Number(blockedUsers || 0),
                suspendedUsers: Number(suspendedUsers || 0),
                lowStockProducts: Number(lowStockProducts || 0),
                lowStockThreshold,
            },
            recentOrders,
            topProducts,
            revenueChartData: { labels, revenueData },
            ordersChartData: { labels, ordersData },
            newUsersChartData: { labels: newUsersLabels, usersData },
        });
    } catch (error) {
        next(error);
    }
};
