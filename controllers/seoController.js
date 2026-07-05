const { query: buildQueryValidator } = require("express-validator");
const Product = require("../models/Product");
const Category = require("../models/Category");

const clampInt = (value, { min, max, fallback }) => {
    const parsed = Number.parseInt(String(value || ""), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
};

exports.sitemapValidators = [
    buildQueryValidator("page").optional().isInt({ min: 1, max: 5000 }).withMessage("Page must be between 1 and 5000"),
    buildQueryValidator("limit").optional().isInt({ min: 1, max: 5000 }).withMessage("Limit must be between 1 and 5000"),
];

// @desc    Sitemap product URLs (slug + lastmod)
// @route   GET /api/seo/sitemap/products
// @access  Public
exports.getSitemapProducts = async (req, res, next) => {
    try {
        const page = clampInt(req.query.page, { min: 1, max: 5000, fallback: 1 });
        const limit = clampInt(req.query.limit, { min: 1, max: 5000, fallback: 5000 });
        const skip = (page - 1) * limit;

        const query = {
            isActive: true,
            slug: { $exists: true, $ne: null, $ne: "" },
        };

        const [items, total] = await Promise.all([
            Product.find(query)
                .select("slug updatedAt")
                .sort({ updatedAt: -1, _id: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Product.countDocuments(query),
        ]);

        res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");

        res.status(200).json({
            success: true,
            page,
            pages: Math.ceil(total / limit),
            total,
            count: items.length,
            items: (items || []).map((p) => ({
                slug: p.slug,
                lastmod: p.updatedAt,
            })),
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Sitemap category URLs (slug + lastmod)
// @route   GET /api/seo/sitemap/categories
// @access  Public
exports.getSitemapCategories = async (req, res, next) => {
    try {
        const page = clampInt(req.query.page, { min: 1, max: 5000, fallback: 1 });
        const limit = clampInt(req.query.limit, { min: 1, max: 5000, fallback: 5000 });
        const skip = (page - 1) * limit;

        const query = {
            isActive: true,
            slug: { $exists: true, $ne: null, $ne: "" },
        };

        const [items, total] = await Promise.all([
            Category.find(query)
                .select("slug name updatedAt")
                .sort({ updatedAt: -1, _id: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Category.countDocuments(query),
        ]);

        res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");

        res.status(200).json({
            success: true,
            page,
            pages: Math.ceil(total / limit),
            total,
            count: items.length,
            items: (items || []).map((c) => ({
                slug: c.slug,
                name: c.name,
                lastmod: c.updatedAt,
            })),
        });
    } catch (error) {
        next(error);
    }
};
