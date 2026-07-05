const mongoose = require("mongoose");

const colorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Color name is required"],
      unique: true,
      trim: true,
    },
    hexCode: {
      type: String,
      default: null,
      validate: {
        validator: function (v) {
          if (!v) return true; // Allow null/empty
          return /^#[0-9A-F]{6}$/i.test(v);
        },
        message: (props) => `${props.value} is not a valid hex color code!`,
      },
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  {
    timestamps: true,
  }
);

// Static method to check if color exists (case-insensitive)
colorSchema.statics.findByNameCaseInsensitive = function (name) {
  return this.findOne({ name: { $regex: new RegExp(`^${name}$`, "i") } });
};

module.exports = mongoose.model("Color", colorSchema);
