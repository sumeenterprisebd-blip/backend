const Category = require("../models/Category");
const Product = require("../models/Product");

// @desc    Get all categories
// @route   GET /api/categories
// @access  Public
exports.getCategories = async (req, res, next) => {
  try {
    // Get all active categories with lean()
    const categories = await Category.find({ isActive: true })
      .sort({ name: 1 })
      .lean();

    // Use aggregation for better performance - single query instead of N+1
    const categoryCounts = await Product.aggregate([
      {
        $match: { isActive: true }
      },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          image: { $first: '$images' }
        }
      }
    ]);

    // Create a map for quick lookup
    const countMap = new Map(
      categoryCounts.map(item => [item._id, { count: item.count, image: item.image?.[0] || null }])
    );

    // Combine data
    let categoriesWithCount = categories.map(category => ({
      _id: category._id,
      name: category.name,
      slug: category.slug,
      count: countMap.get(category.name)?.count || 0,
      image: countMap.get(category.name)?.image || null,
      createdAt: category.createdAt,
    }));

    // Optionally hide categories with no active products
    if (String(req.query.onlyWithActiveProducts || '').toLowerCase() === 'true') {
      categoriesWithCount = categoriesWithCount.filter(category => (category.count || 0) > 0);
    }

    // Set cache headers (shorter for quicker admin updates)
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');

    res.status(200).json({
      success: true,
      count: categoriesWithCount.length,
      categories: categoriesWithCount,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single category
// @route   GET /api/categories/:id
// @access  Public
exports.getCategory = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    res.status(200).json({
      success: true,
      category,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create category
// @route   POST /api/categories
// @access  Private/Admin
exports.createCategory = async (req, res, next) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Category name is required",
      });
    }

    // Check if category already exists (case-insensitive)
    const existingCategory = await Category.findOne({
      name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
    });

    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: "This category already exists",
      });
    }

    const category = await Category.create({ name: name.trim() });

    res.status(201).json({
      success: true,
      message: "Category added successfully",
      category,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "This category already exists",
      });
    }
    next(error);
  }
};

// @desc    Update category
// @route   PUT /api/categories/:id
// @access  Private/Admin
exports.updateCategory = async (req, res, next) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Category name is required",
      });
    }

    // Check if another category with this name exists (case-insensitive)
    const existingCategory = await Category.findOne({
      name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
      _id: { $ne: req.params.id },
    });

    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: "This category name already exists",
      });
    }

    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { name: name.trim() },
      { new: true, runValidators: true }
    );

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Category updated successfully",
      category,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "This category name already exists",
      });
    }
    next(error);
  }
};

// @desc    Delete category
// @route   DELETE /api/categories/:id
// @access  Private/Admin
exports.deleteCategory = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // Check if any products use this category
    const productsCount = await Product.countDocuments({
      category: category.name,
    });

    if (productsCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category. ${productsCount} product(s) are using this category`,
      });
    }

    await category.deleteOne();

    res.status(200).json({
      success: true,
      message: "Category deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
