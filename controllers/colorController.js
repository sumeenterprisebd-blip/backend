const Color = require("../models/Color");

// @desc    Get all colors
// @route   GET /api/colors
// @access  Public
exports.getColors = async (req, res, next) => {
  try {
    const { status } = req.query;

    const filter = {};
    if (status) {
      filter.status = status;
    }

    const colors = await Color.find(filter).sort({ name: 1 });

    res.status(200).json({
      success: true,
      count: colors.length,
      colors,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single color
// @route   GET /api/colors/:id
// @access  Public
exports.getColor = async (req, res, next) => {
  try {
    const color = await Color.findById(req.params.id);

    if (!color) {
      return res.status(404).json({
        success: false,
        message: "Color not found",
      });
    }

    res.status(200).json({
      success: true,
      color,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new color
// @route   POST /api/colors
// @access  Private/Admin
exports.createColor = async (req, res, next) => {
  try {
    const { name, hexCode, status } = req.body;

    // Check if color already exists (case-insensitive)
    const existingColor = await Color.findByNameCaseInsensitive(name);
    if (existingColor) {
      return res.status(400).json({
        success: false,
        message: "Color already exists",
      });
    }

    const color = await Color.create({
      name: name.trim(),
      hexCode: hexCode || null,
      status: status || "active",
    });

    res.status(201).json({
      success: true,
      color,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update color
// @route   PUT /api/colors/:id
// @access  Private/Admin
exports.updateColor = async (req, res, next) => {
  try {
    const { name, hexCode, status } = req.body;

    let color = await Color.findById(req.params.id);

    if (!color) {
      return res.status(404).json({
        success: false,
        message: "Color not found",
      });
    }

    // If name is being updated, check for duplicates
    if (name && name !== color.name) {
      const existingColor = await Color.findByNameCaseInsensitive(name);
      if (existingColor) {
        return res.status(400).json({
          success: false,
          message: "Color name already exists",
        });
      }
    }

    color.name = name || color.name;
    color.hexCode = hexCode !== undefined ? hexCode : color.hexCode;
    color.status = status || color.status;

    await color.save();

    res.status(200).json({
      success: true,
      color,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete color
// @route   DELETE /api/colors/:id
// @access  Private/Admin
exports.deleteColor = async (req, res, next) => {
  try {
    const color = await Color.findById(req.params.id);

    if (!color) {
      return res.status(404).json({
        success: false,
        message: "Color not found",
      });
    }

    await color.deleteOne();

    res.status(200).json({
      success: true,
      message: "Color deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
