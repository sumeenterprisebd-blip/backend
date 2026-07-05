const { validationResult } = require('express-validator');

// Check validation results
exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: errors.array()[0].msg || 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

