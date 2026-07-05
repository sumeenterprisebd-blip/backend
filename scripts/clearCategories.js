const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Category = require("../models/Category");
const Product = require("../models/Product");

dotenv.config();

const clearCategories = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);

    // Get all categories
    const allCategories = await Category.find();

    if (allCategories.length > 0) {
      allCategories.forEach((cat, index) => {
      });

      // Check if any products reference these categories
      const productsWithCategories = await Product.find({
        category: { $in: allCategories.map((c) => c.name) },
      });

      // Delete all categories
      const result = await Category.deleteMany({});
    } else {
    }

    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
};

clearCategories();
