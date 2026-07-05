const mongoose = require("mongoose");

const measurementSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Measurement name is required"],
      unique: true,
      trim: true,
    },
    slug: {
      type: String,
      required: false,
      unique: true,
      lowercase: true,
      trim: true,
    },
    fields: [
      {
        type: String,
        required: [true, "Measurement field is required"],
        trim: true,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

measurementSchema.pre("save", function (next) {
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

module.exports = mongoose.model("Measurement", measurementSchema);
