const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Category = require("../models/Category");

dotenv.config();

const defaultCategories = [];

const seedCategories = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);

    // Check existing categories
    const existingCategories = await Category.find();

    // Add only new categories
    let addedCount = 0;
    for (const categoryName of defaultCategories) {
      const exists = await Category.findOne({
        name: { $regex: new RegExp(`^${categoryName}$`, "i") },
      });

      if (!exists) {
        await Category.create({ name: categoryName });
        addedCount++;
      }
    }

    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
};

seedCategories();
