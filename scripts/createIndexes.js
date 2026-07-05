// Script to create database indexes for optimal query performance
// Run this after deployment to ensure all indexes are created
// Usage: node scripts/createIndexes.js

const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Import models
const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');
const Order = require('../models/Order');
const Review = require('../models/Review');

const createIndexes = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 30000,
    });

    // Product indexes
    // Migrate legacy text index (MongoDB allows only one text index per collection).
    // If an old text index exists with a different name, drop it so the weighted
    // schema index (product_text_search) can be created.
    try {
      const existing = await Product.collection.indexes();
      const textIndexes = (existing || []).filter((idx) => idx?.key?._fts === "text");
      const legacyText = textIndexes.find((idx) => idx?.name && idx.name !== "product_text_search");
      if (legacyText?.name) {
        console.log(`[INDEX] Dropping legacy Product text index: ${legacyText.name}`);
        await Product.collection.dropIndex(legacyText.name);
      }
    } catch (e) {
      // Best-effort migration; continue to create other indexes.
      console.warn("[INDEX] Product text index migration warning:", e?.message || e);
    }

    await Product.createIndexes();

    // Category indexes
    await Category.createIndexes();

    // User indexes
    await User.createIndexes();

    // Order indexes
    await Order.createIndexes();

    // Review indexes
    await Review.createIndexes();

    // List all indexes for Products
    const productIndexes = await Product.collection.indexes();
    console.log(`[INDEX] Product indexes (${productIndexes.length}):`);
    for (const idx of productIndexes) {
      console.log(`- ${idx.name}`);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating indexes:', error);
    process.exit(1);
  }
};

createIndexes();
