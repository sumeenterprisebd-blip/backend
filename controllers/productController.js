const Product = require("../models/Product");

const escapeRegExp = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildPartialSearchAndFilter = (rawSearch) => {
  const search = String(rawSearch || "").trim();
  if (!search) return null;

  // Guardrails to keep queries predictable and fast.
  const trimmed = search.slice(0, 64);
  const tokens = trimmed
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6);

  if (tokens.length === 0) return null;

  return tokens.map((token) => {
    const regex = new RegExp(escapeRegExp(token), "i");
    return {
      $or: [
        { name: { $regex: regex } },
        // Some datasets may use `title` instead of `name`.
        { title: { $regex: regex } },
        { slug: { $regex: regex } },
        { category: { $regex: regex } },
      ],
    };
  });
};

// @desc    Get all products
// @route   GET /api/products
// @access  Public
exports.getProducts = async (req, res, next) => {
  try {
    const {
      category,
      color,
      size,
      minPrice,
      maxPrice,
      search,
      sort,
      page = 1,
      limit = 12,
      featured,
      isNewArrival,
    } = req.query;

    // Build query
    const query = { isActive: true };

    if (category) {
      query.category = Array.isArray(category) ? { $in: category } : category;
    }

    if (color) {
      query.colors = { $in: Array.isArray(color) ? color : [color] };
    }

    if (size) {
      query.sizes = { $in: Array.isArray(size) ? size : [size] };
    }

    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    const searchAnd = buildPartialSearchAndFilter(search);
    if (searchAnd) {
      query.$and = [...(query.$and || []), ...searchAnd];
    }

    if (featured === "true") {
      query.isFeatured = true;
    }

    if (isNewArrival !== undefined) {
      query.isNewArrival = isNewArrival === "true";
    }

    // Sort options
    let sortOption = {};
    if (sort) {
      switch (sort) {
        case "category-min-price-low":
          // Handled via aggregation below for global ordering by category min price.
          sortOption = null;
          break;
        case "category-price-low":
          sortOption = { category: 1, price: 1, _id: 1 };
          break;
        case "price-low":
          sortOption = { price: 1 };
          break;
        case "price-high":
          sortOption = { price: -1 };
          break;
        case "rating":
          sortOption = { rating: -1 };
          break;
        case "newest":
          sortOption = { createdAt: -1 };
          break;
        default:
          sortOption = { createdAt: -1 };
      }
    } else {
      sortOption = { createdAt: -1 };
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    let products;

    // Special: order categories by their minimum product price (cheapest category first),
    // then within category by price asc. This keeps category blocks sequential across pages.
    if (sort === "category-min-price-low") {
      try {
        products = await Product.aggregate([
          { $match: query },
          {
            $setWindowFields: {
              partitionBy: "$category",
              sortBy: { price: 1, _id: 1 },
              output: {
                __categoryMinPrice: {
                  $min: "$price",
                  window: { documents: ["unbounded", "unbounded"] },
                },
              },
            },
          },
          { $sort: { __categoryMinPrice: 1, category: 1, price: 1, _id: 1 } },
          { $skip: skip },
          { $limit: limitNum },
          { $project: { __v: 0, __categoryMinPrice: 0 } },
        ]);
      } catch {
        // Fallback for older MongoDB versions without $setWindowFields.
        products = await Product.find(query)
          .select("-__v")
          .sort({ category: 1, price: 1, _id: 1 })
          .skip(skip)
          .limit(limitNum)
          .lean();
      }
    } else {
      // Optimized query with lean() and select() for better performance
      products = await Product.find(query)
        .select('-__v') // Exclude version field
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum)
        .lean(); // Convert to plain JS objects (50% faster)
    }

    // Use countDocuments with the same query for accuracy
    const total = await Product.countDocuments(query);

    // Set cache headers
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');

    res.status(200).json({
      success: true,
      count: products.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      products,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all products (Admin)
// @route   GET /api/products/admin/all
// @access  Private/Admin
exports.getAdminProducts = async (req, res, next) => {
  try {
    const {
      category,
      color,
      size,
      minPrice,
      maxPrice,
      search,
      sort,
      page = 1,
      limit = 12,
      featured,
      isActive,
      isNewArrival,
    } = req.query;

    // Build query - admin can see active and inactive
    const query = {};

    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    if (category) {
      query.category = Array.isArray(category) ? { $in: category } : category;
    }

    if (color) {
      query.colors = { $in: Array.isArray(color) ? color : [color] };
    }

    if (size) {
      query.sizes = { $in: Array.isArray(size) ? size : [size] };
    }

    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    const searchAnd = buildPartialSearchAndFilter(search);
    if (searchAnd) {
      query.$and = [...(query.$and || []), ...searchAnd];
    }

    if (featured === "true") {
      query.isFeatured = true;
    }

    if (isNewArrival !== undefined) {
      query.isNewArrival = isNewArrival === "true";
    }

    // Sort options
    let sortOption = {};
    if (sort) {
      switch (sort) {
        case "price-low":
          sortOption = { price: 1 };
          break;
        case "price-high":
          sortOption = { price: -1 };
          break;
        case "rating":
          sortOption = { rating: -1 };
          break;
        case "newest":
          sortOption = { createdAt: -1 };
          break;
        default:
          sortOption = { createdAt: -1 };
      }
    } else {
      sortOption = { createdAt: -1 };
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const products = await Product.find(query)
      .select("-__v")
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum)
      .lean();

    const total = await Product.countDocuments(query);

    // Disable caching for admin data
    res.set("Cache-Control", "no-store");

    res.status(200).json({
      success: true,
      count: products.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      products,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Public
exports.getProduct = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Product identifier is required",
      });
    }

    // Build query - try to match by ID (if valid ObjectId) or slug
    const mongoose = require("mongoose");
    const isValidObjectId = mongoose.Types.ObjectId.isValid(id);

    let query;
    if (isValidObjectId) {
      // If it's a valid ObjectId, try both _id and slug
      query = {
        $or: [{ _id: id }, { slug: id }],
      };
    } else {
      // If not a valid ObjectId, only search by slug
      query = { slug: id };
    }

    // Find product and populate measurement category data
    const product = await Product.findOne(query).populate({
      path: 'measurements.category',
      select: 'name fields'
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    if (!product.isActive) {
      return res.status(404).json({
        success: false,
        message: "Product is not available",
      });
    }

    res.status(200).json({
      success: true,
      product,
    });
  } catch (error) {
    // Handle MongoDB cast errors
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid product identifier",
      });
    }

    // Log the error for debugging

    return res.status(500).json({
      success: false,
      message: "Error fetching product",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// @desc    Create product
// @route   POST /api/products
// @access  Private/Admin
exports.createProduct = async (req, res, next) => {
  try {
    const { name, price, stock, category, colors, sizes, images } = req.body;

    if (!name || !price || stock === undefined || !category) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: name, price, stock, and category are required",
      });
    }

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one image is required",
      });
    }

    const validImages = images.filter((img) => img && img.trim());
    if (validImages.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one valid image URL is required",
      });
    }

    const productData = {
      name: name.trim(),
      price: Number(price),
      stock: Number(stock),
      category,
      images: validImages,
      description: req.body.description?.trim() || "",
      dressStyle: req.body.dressStyle || "Casual",
      isFeatured: req.body.isFeatured || false,
      isNewArrival: req.body.isNewArrival || false,
      isActive: req.body.isActive !== undefined ? req.body.isActive : true,
      isComboOffer: req.body.isComboOffer || false,
      freeDelivery: req.body.freeDelivery || false,
    };

    // Include optional colors/sizes only if provided by the client
    if (Array.isArray(colors) && colors.length > 0) {
      productData.colors = colors;
    }

    if (Array.isArray(sizes) && sizes.length > 0) {
      productData.sizes = sizes;
    }

    if (Array.isArray(req.body.measurements)) {
      const cleanGroups = req.body.measurements
        .filter((group) => group && group.category && Array.isArray(group.sizes))
        .map((group) => ({
          category: group.category,
          sizes: group.sizes
            .filter((row) => row && row.size && String(row.size).trim())
            .map((row) => ({
              size: String(row.size).trim(),
              values:
                row.values && typeof row.values === 'object'
                  ? Object.fromEntries(
                    Object.entries(row.values).map(([key, value]) => [
                      String(key).trim(),
                      String(value || "").trim(),
                    ])
                  )
                  : {},
            })),
        }))
        .filter((group) => group.sizes.length > 0);

      if (cleanGroups.length > 0) {
        productData.measurements = cleanGroups;
      }
    }

    if (productData.isComboOffer && productData.freeDelivery) {
      const parsedMinQty = parseInt(req.body.freeDeliveryMinQty, 10);
      productData.freeDeliveryMinQty = !isNaN(parsedMinQty) && parsedMinQty >= 1 ? parsedMinQty : 2;
    }

    if (
      req.body.originalPrice &&
      !isNaN(parseFloat(req.body.originalPrice)) &&
      parseFloat(req.body.originalPrice) > 0
    ) {
      productData.originalPrice = Number(req.body.originalPrice);
    }

    if (
      req.body.discount !== undefined &&
      !isNaN(parseFloat(req.body.discount)) &&
      parseFloat(req.body.discount) >= 0 &&
      parseFloat(req.body.discount) <= 100
    ) {
      productData.discount = Number(req.body.discount);
    }

    if (
      req.body.comboPrice &&
      !isNaN(parseFloat(req.body.comboPrice)) &&
      parseFloat(req.body.comboPrice) > 0
    ) {
      productData.comboPrice = Number(req.body.comboPrice);
    }

    if (
      req.body.comboDiscount !== undefined &&
      !isNaN(parseFloat(req.body.comboDiscount)) &&
      parseFloat(req.body.comboDiscount) >= 0 &&
      parseFloat(req.body.comboDiscount) <= 100
    ) {
      productData.comboDiscount = Number(req.body.comboDiscount);
    }

    if (Array.isArray(req.body.pricingTiers)) {
      productData.pricingTiers = req.body.pricingTiers
        .filter((tier) => tier && Number.isFinite(Number(tier.minQty)) && Number(tier.minQty) > 0 && Number.isFinite(Number(tier.price)))
        .map((tier) => ({
          minQty: Number(tier.minQty),
          maxQty: tier.maxQty === "" || tier.maxQty === null || tier.maxQty === undefined ? null : Number(tier.maxQty),
          price: Number(tier.price),
        }))
        .sort((a, b) => a.minQty - b.minQty);
    }

    if (
      req.body.tags &&
      Array.isArray(req.body.tags) &&
      req.body.tags.length > 0
    ) {
      productData.tags = req.body.tags.filter((t) => t && t.trim());
    }

    const product = await Product.create(productData);

    res.status(201).json({
      success: true,
      product,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "A product with this name already exists",
      });
    }

    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: `Validation error: ${errors.join(", ")}`,
        errors: errors,
      });
    }

    next(error);
  }
};

// @desc    Update product
// @route   PUT /api/products/:id
// @access  Private/Admin
exports.updateProduct = async (req, res, next) => {
  try {
    let product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const wasActive = product.isActive;
    const productId = req.params.id;

    // Build update data with proper validation
    const updateData = { ...req.body };

    if (Array.isArray(updateData.pricingTiers)) {
      updateData.pricingTiers = updateData.pricingTiers
        .filter((tier) => tier && Number.isFinite(Number(tier.minQty)) && Number(tier.minQty) > 0 && Number.isFinite(Number(tier.price)))
        .map((tier) => ({
          minQty: Number(tier.minQty),
          maxQty: tier.maxQty === "" || tier.maxQty === null || tier.maxQty === undefined ? null : Number(tier.maxQty),
          price: Number(tier.price),
        }))
        .sort((a, b) => a.minQty - b.minQty);
    }

    if (Array.isArray(updateData.measurements)) {
      updateData.measurements = updateData.measurements
        .filter((group) => group && group.category && Array.isArray(group.sizes))
        .map((group) => ({
          category: group.category,
          sizes: group.sizes
            .filter((row) => row && row.size && String(row.size).trim())
            .map((row) => ({
              size: String(row.size).trim(),
              values:
                row.values && typeof row.values === 'object'
                  ? Object.fromEntries(
                    Object.entries(row.values).map(([key, value]) => [
                      String(key).trim(),
                      String(value || "").trim(),
                    ])
                  )
                  : {},
            })),
        }))
        .filter((group) => group.sizes.length > 0);
    }

    product = await Product.findByIdAndUpdate(productId, updateData, {
      new: true,
      runValidators: true,
    });

    // If product was active and is now inactive, remove from all carts
    let cartsUpdated = 0;
    if (wasActive && product.isActive === false) {
      const Cart = require("../models/Cart");
      const updateResult = await Cart.updateMany(
        { "items.product": productId },
        { $pull: { items: { product: productId } } }
      );
      cartsUpdated = updateResult.modifiedCount;
    }

    res.status(200).json({
      success: true,
      product,
      cartsUpdated,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: `Validation error: ${errors.join(", ")}`,
        errors: errors,
      });
    }

    next(error);
  }
};

// @desc    Delete product
// @route   DELETE /api/products/:id
// @access  Private/Admin
exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const productId = req.params.id;

    // Delete the product
    await product.deleteOne();

    // Remove this product from all user carts
    const Cart = require("../models/Cart");
    const updateResult = await Cart.updateMany(
      { "items.product": productId },
      { $pull: { items: { product: productId } } }
    );

    res.status(200).json({
      success: true,
      message: "Product deleted successfully",
      cartsUpdated: updateResult.modifiedCount,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get product categories
// @route   GET /api/products/categories
// @access  Public
exports.getCategories = async (req, res, next) => {
  try {
    const categories = await Product.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    res.status(200).json({
      success: true,
      categories: categories.map((cat) => ({
        name: cat._id,
        count: cat.count,
      })),
    });
  } catch (error) {
    next(error);
  }
};
