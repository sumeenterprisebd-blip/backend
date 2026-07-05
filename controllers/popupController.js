const Popup = require("../models/Popup");

// @desc    Get active homepage popup
// @route   GET /api/popup/homepage
// @access  Public
exports.getHomepagePopup = async (req, res, next) => {
  try {
    const popup = await Popup.getActiveHomepagePopup();

    res.status(200).json({
      success: true,
      popup,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all popups
// @route   GET /api/popup
// @access  Private (Admin)
exports.getPopups = async (req, res, next) => {
  try {
    const popups = await Popup.find().sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: popups.length,
      popups,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single popup
// @route   GET /api/popup/:id
// @access  Private (Admin)
exports.getPopup = async (req, res, next) => {
  try {
    const popup = await Popup.findById(req.params.id);

    if (!popup) {
      return res.status(404).json({
        success: false,
        message: "Popup not found",
      });
    }

    res.status(200).json({
      success: true,
      popup,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create popup
// @route   POST /api/popup
// @access  Private (Admin)
exports.createPopup = async (req, res, next) => {
  try {
    const popup = await Popup.create(req.body);

    res.status(201).json({
      success: true,
      popup,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update popup
// @route   PUT /api/popup/:id
// @access  Private (Admin)
exports.updatePopup = async (req, res, next) => {
  try {
    let popup = await Popup.findById(req.params.id);

    if (!popup) {
      return res.status(404).json({
        success: false,
        message: "Popup not found",
      });
    }

    popup = await Popup.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      popup,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete popup
// @route   DELETE /api/popup/:id
// @access  Private (Admin)
exports.deletePopup = async (req, res, next) => {
  try {
    const popup = await Popup.findById(req.params.id);

    if (!popup) {
      return res.status(404).json({
        success: false,
        message: "Popup not found",
      });
    }

    await popup.deleteOne();

    res.status(200).json({
      success: true,
      message: "Popup deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle popup active status
// @route   PATCH /api/popup/:id/toggle
// @access  Private (Admin)
exports.togglePopupStatus = async (req, res, next) => {
  try {
    const popup = await Popup.findById(req.params.id);

    if (!popup) {
      return res.status(404).json({
        success: false,
        message: "Popup not found",
      });
    }

    popup.isActive = !popup.isActive;
    await popup.save();

    res.status(200).json({
      success: true,
      popup,
    });
  } catch (error) {
    next(error);
  }
};
