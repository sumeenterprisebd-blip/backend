const { query: buildQueryValidator } = require("express-validator");
const Product = require("../models/Product");

const clampInt = (value, { min, max, fallback }) => {
    const parsed = Number.parseInt(String(value || ""), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
};

const sanitizeSearchQuery = (raw) => {
    if (raw === null || raw === undefined) return "";

    const text = String(raw).replace(/\s+/g, " ").trim();
    return text.length > 64 ? text.slice(0, 64).trim() : text;
};

const toStringArray = (value) => {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
    const str = String(value).trim();
    return str ? [str] : [];
};

const buildFilters = (req) => {
    const q = sanitizeSearchQuery(req.query.q ?? req.query.search ?? req.query.query);

    const category = toStringArray(req.query.category);
    const color = toStringArray(req.query.color);
    const size = toStringArray(req.query.size);

    const minPrice = req.query.minPrice !== undefined ? Number(req.query.minPrice) : undefined;
    const maxPrice = req.query.maxPrice !== undefined ? Number(req.query.maxPrice) : undefined;

    const featured = req.query.featured === "true";
    const isNewArrival = req.query.isNewArrival === "true";
    const inStock = req.query.inStock === "true";

    const filter = { isActive: true };

    if (category.length) filter.category = category.length === 1 ? category[0] : { $in: category };
    if (color.length) filter.colors = { $in: color };
    if (size.length) filter.sizes = { $in: size };

    if (Number.isFinite(minPrice) || Number.isFinite(maxPrice)) {
        filter.price = {};
        if (Number.isFinite(minPrice)) filter.price.$gte = Number(minPrice);
        if (Number.isFinite(maxPrice)) filter.price.$lte = Number(maxPrice);
    }

    if (featured) filter.isFeatured = true;
    if (req.query.isNewArrival !== undefined) filter.isNewArrival = isNewArrival;
    if (inStock) filter.stock = { $gt: 0 };

    return { q, filter };
};

const buildSort = ({ q, sort }) => {
    const normalized = String(sort || "").trim();

    if (normalized === "name-asc") return { name: 1, _id: 1 };
    if (normalized === "name-desc") return { name: -1, _id: 1 };
    if (normalized === "price-low") return { price: 1, _id: 1 };
    if (normalized === "price-high") return { price: -1, _id: 1 };
    if (normalized === "rating") return { rating: -1, _id: 1 };
    if (normalized === "newest") return { createdAt: -1, _id: 1 };

    // Default
    if (q) {
        return { score: { $meta: "textScore" }, createdAt: -1, _id: 1 };
    }

    return { createdAt: -1, _id: 1 };
};

// Validators
exports.searchValidators = [
    buildQueryValidator("q").optional().isString().withMessage("Search query must be a string"),
    buildQueryValidator("search").optional().isString().withMessage("Search query must be a string"),
    buildQueryValidator("limit").optional().isInt({ min: 1, max: 50 }).withMessage("Limit must be between 1 and 50"),
    buildQueryValidator("page").optional().isInt({ min: 1, max: 5000 }).withMessage("Page must be between 1 and 5000"),
];

exports.suggestValidators = [
    buildQueryValidator("q").isString().withMessage("Search query is required"),
    buildQueryValidator("limit").optional().isInt({ min: 1, max: 20 }).withMessage("Limit must be between 1 and 20"),
];

// @desc    Server-side product search (filters + pagination)
// @route   GET /api/search
// @access  Public
exports.searchProducts = async (req, res, next) => {
    const start = Date.now();

    try {
        const { q, filter } = buildFilters(req);

        const page = clampInt(req.query.page, { min: 1, max: 5000, fallback: 1 });
        const limit = clampInt(req.query.limit, { min: 1, max: 50, fallback: 12 });
        const skip = (page - 1) * limit;

        const sort = buildSort({ q, sort: req.query.sort });

        const mongoQuery = { ...filter };

        let projection = undefined;
        if (q) {
            mongoQuery.$text = { $search: q };
            projection = { score: { $meta: "textScore" } };
        }

        const products = await Product.find(mongoQuery, projection)
            .select("-__v")
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean();

        const total = await Product.countDocuments(mongoQuery);

        res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");

        res.status(200).json({
            success: true,
            q,
            count: products.length,
            total,
            page,
            pages: Math.ceil(total / limit),
            products,
            meta: {
                sort: String(req.query.sort || (q ? "relevance" : "newest")),
                tookMs: Date.now() - start,
                usedTextSearch: Boolean(q),
            },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Autocomplete suggestions for products
// @route   GET /api/search/suggest
// @access  Public
exports.suggestProducts = async (req, res, next) => {
    const start = Date.now();

    try {
        const q = sanitizeSearchQuery(req.query.q);
        const limit = clampInt(req.query.limit, { min: 1, max: 20, fallback: 6 });

        if (!q || q.length < 2) {
            return res.status(200).json({
                success: true,
                q,
                count: 0,
                results: [],
                meta: { tookMs: Date.now() - start },
            });
        }

        // Use text search for speed (uses MongoDB text index).
        // This is intentionally minimal and can be swapped for Atlas Search / Meilisearch later.
        const mongoQuery = { isActive: true, $text: { $search: q } };

        const docs = await Product.find(mongoQuery, { score: { $meta: "textScore" } })
            .select("name slug price images")
            .sort({ score: { $meta: "textScore" }, createdAt: -1, _id: 1 })
            .limit(limit)
            .lean();

        const results = (docs || [])
            .map((p) => ({
                _id: p._id,
                id: p._id,
                slug: p.slug,
                name: p.name,
                price: Number(p.price || 0),
                image: Array.isArray(p.images) && p.images[0] ? p.images[0] : "/logo.jpeg",
                link: `/product/${p.slug || p._id}`,
            }))
            .filter((p) => Boolean(p.id) && Boolean(p.name));

        res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");

        res.status(200).json({
            success: true,
            q,
            count: results.length,
            results,
            meta: {
                tookMs: Date.now() - start,
            },
        });
    } catch (error) {
        next(error);
    }
};
