const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  logo: {
    type: String,
    required: true
  },
  website: {
    type: String,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  pressRelease: {
    title: {
      type: String,
      trim: true
    },
    content: {
      type: String,
      trim: true
    },
    publishedDate: {
      type: Date
    },
    isPublished: {
      type: Boolean,
      default: false
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  displayOrder: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index for active brands
brandSchema.index({ isActive: 1, displayOrder: 1 });

module.exports = mongoose.model('Brand', brandSchema);

