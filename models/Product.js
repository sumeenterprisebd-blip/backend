const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
    },
    slug: {
      type: String,
      required: false, // Will be auto-generated in pre-save hook
      unique: true,
      lowercase: true,
    },
    description: {
      type: String,
      trim: true,
    },
    images: [
      {
        type: String,
        required: true,
      },
    ],
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price must be positive"],
    },
    originalPrice: {
      type: Number,
      default: null,
    },
    discount: {
      type: Number,
      default: null,
      min: [0, "Discount cannot be negative"],
      max: [100, "Discount cannot exceed 100%"],
    },
    isComboOffer: {
      type: Boolean,
      default: false,
    },
    comboPrice: {
      type: Number,
      default: null,
      min: [0, "Combo price must be positive"],
    },
    comboDiscount: {
      type: Number,
      default: null,
      min: [0, "Combo discount cannot be negative"],
      max: [100, "Combo discount cannot exceed 100%"],
    },
    freeDelivery: {
      type: Boolean,
      default: false,
    },
    freeDeliveryMinQty: {
      type: Number,
      default: 2,
      min: [1, "Free delivery minimum quantity must be at least 1"],
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      trim: true,
    },
    measurements: [
      {
        category: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Measurement",
          required: true,
        },
        sizes: [
          {
            size: {
              type: String,
              required: true,
              trim: true,
            },
            values: {
              type: Map,
              of: String,
              default: {},
            },
          },
        ],
      },
    ],
    colors: [
      {
        type: mongoose.Schema.Types.Mixed, // Can be String or Object {name, hex}
        required: true,
      },
    ],
    sizes: [
      {
        type: String,
        required: true,
        enum: ["S", "M", "L", "XL", "XXL"],
      },
    ],
    dressStyle: {
      type: String,
      enum: ["Casual", "Formal", "Sport", "Other"],
      default: "Casual",
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    numReviews: {
      type: Number,
      default: 0,
    },
    stock: {
      type: Number,
      required: true,
      min: [0, "Stock cannot be negative"],
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isNewArrival: {
      type: Boolean,
      default: false,
    },
    tags: [String],
  },
  {
    timestamps: true,
  }
);

// Generate slug from name before saving
productSchema.pre("save", function (next) {
  // Always generate slug if it doesn't exist or name has changed
  // For new documents, isNew will be true, so we always generate slug
  if (this.isNew || !this.slug || this.isModified("name")) {
    if (this.name) {
      this.slug = this.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
    }
  }
  next();
});

// Index for search (MongoDB text index)
// Note: Can be swapped for Atlas Search / external engines later.
productSchema.index(
  {
    name: "text",
    slug: "text",
    category: "text",
    tags: "text",
    description: "text",
  },
  {
    name: "product_text_search",
    weights: {
      name: 10,
      slug: 8,
      category: 4,
      tags: 3,
      description: 1,
    },
  }
);

// Compound indexes for common queries (order matters!)
productSchema.index({ isActive: 1, category: 1, createdAt: -1 }); // Most common query
productSchema.index({ isActive: 1, isFeatured: 1, createdAt: -1 }); // Featured products
productSchema.index({ isActive: 1, price: 1 }); // Price filtering
productSchema.index({ isActive: 1, rating: -1 }); // Rating sorting
productSchema.index({ category: 1, isActive: 1 }); // Category lookup
productSchema.index({ createdAt: -1 }); // Newest first

module.exports = mongoose.model("Product", productSchema);
