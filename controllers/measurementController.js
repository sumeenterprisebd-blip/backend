const Measurement = require("../models/Measurement");
const Product = require("../models/Product");

// @desc    Get all measurements
// @route   GET /api/measurements
// @access  Public
exports.getMeasurements = async (req, res, next) => {
  try {
    const measurements = await Measurement.find({ isActive: true })
      .sort({ name: 1 })
      .lean();

    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');

    res.status(200).json({
      success: true,
      count: measurements.length,
      measurements,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single measurement
// @route   GET /api/measurements/:id
// @access  Public
exports.getMeasurement = async (req, res, next) => {
  try {
    const measurement = await Measurement.findById(req.params.id);

    if (!measurement) {
      return res.status(404).json({
        success: false,
        message: "Measurement not found",
      });
    }

    res.status(200).json({
      success: true,
      measurement,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create measurement
// @route   POST /api/measurements
// @access  Private/Admin
exports.createMeasurement = async (req, res, next) => {
  try {
    const { name, fields } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Measurement name is required",
      });
    }

    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one field is required",
      });
    }

    const cleanFields = fields
      .map((field) => String(field || "").trim())
      .filter((field) => field.length > 0);

    if (cleanFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one valid field is required",
      });
    }

    const existingMeasurement = await Measurement.findOne({
      name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
    });

    if (existingMeasurement) {
      return res.status(400).json({
        success: false,
        message: "This measurement category already exists",
      });
    }

    const measurement = await Measurement.create({
      name: name.trim(),
      fields: [...new Set(cleanFields)],
    });

    res.status(201).json({
      success: true,
      message: "Measurement category created successfully",
      measurement,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "This measurement category already exists",
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

// @desc    Update measurement
// @route   PUT /api/measurements/:id
// @access  Private/Admin
exports.updateMeasurement = async (req, res, next) => {
  try {
    const { name, fields } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Measurement name is required",
      });
    }

    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one field is required",
      });
    }

    const cleanFields = fields
      .map((field) => String(field || "").trim())
      .filter((field) => field.length > 0);

    if (cleanFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one valid field is required",
      });
    }

    const existingMeasurement = await Measurement.findOne({
      name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
      _id: { $ne: req.params.id },
    });

    if (existingMeasurement) {
      return res.status(400).json({
        success: false,
        message: "This measurement name already exists",
      });
    }

    const measurement = await Measurement.findByIdAndUpdate(
      req.params.id,
      {
        name: name.trim(),
        fields: [...new Set(cleanFields)],
      },
      { new: true, runValidators: true }
    );

    if (!measurement) {
      return res.status(404).json({
        success: false,
        message: "Measurement not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Measurement category updated successfully",
      measurement,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "This measurement name already exists",
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

// @desc    Delete measurement
// @route   DELETE /api/measurements/:id
// @access  Private/Admin
exports.deleteMeasurement = async (req, res, next) => {
  try {
    const measurement = await Measurement.findById(req.params.id);

    if (!measurement) {
      return res.status(404).json({
        success: false,
        message: "Measurement not found",
      });
    }

    // Check if any products use this measurement category
    const productsCount = await Product.countDocuments({
      "measurements.category": req.params.id,
    });

    if (productsCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete measurement. ${productsCount} product(s) are using this measurement category`,
      });
    }

    await measurement.deleteOne();

    res.status(200).json({
      success: true,
      message: "Measurement deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
