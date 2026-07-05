const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Category = require("../models/Category");
const Color = require("../models/Color");

// Load environment variables
dotenv.config();

const categories = [];

const colors = [
  { name: "Black", hexCode: "#000000" },
  { name: "White", hexCode: "#FFFFFF" },
  { name: "Red", hexCode: "#FF0000" },
  { name: "Blue", hexCode: "#0000FF" },
  { name: "Green", hexCode: "#008000" },
  { name: "Yellow", hexCode: "#FFFF00" },
  { name: "Gray", hexCode: "#808080" },
  { name: "Brown", hexCode: "#A52A2A" },
  { name: "Pink", hexCode: "#FFC0CB" },
  { name: "Purple", hexCode: "#800080" },
  { name: "Orange", hexCode: "#FFA500" },
  { name: "Navy", hexCode: "#000080" },
  { name: "Beige", hexCode: "#F5F5DC" },
];

const seedCategoriesAndColors = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);

    // Seed categories
    for (const category of categories) {
      const existing = await Category.findByNameCaseInsensitive(category.name);
      if (!existing) {
        await Category.create(category);
      }
    }

    // Seed colors
    for (const color of colors) {
      const existing = await Color.findByNameCaseInsensitive(color.name);
      if (!existing) {
        await Color.create(color);
      }
    }

    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
};

seedCategoriesAndColors();
