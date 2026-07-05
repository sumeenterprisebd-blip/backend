const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Brand = require('../models/Brand');

dotenv.config();

const cleanBrands = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    // Find all brands
    const allBrands = await Brand.find({});

    // Remove brands with empty or invalid names/logos
    const invalidBrands = await Brand.deleteMany({
      $or: [
        { name: { $exists: false } },
        { name: '' },
        { name: { $regex: /^\s*$/ } },
        { logo: { $exists: false } },
        { logo: '' },
        { logo: { $regex: /^\s*$/ } }
      ]
    });

    // Remove duplicate brands by name (case-insensitive)
    const brands = await Brand.find({}).sort({ createdAt: 1 });
    const seenNames = new Set();
    let duplicatesRemoved = 0;

    for (const brand of brands) {
      const nameLower = brand.name.toLowerCase().trim();
      if (seenNames.has(nameLower)) {
        await Brand.deleteOne({ _id: brand._id });
        duplicatesRemoved++;
      } else {
        seenNames.add(nameLower);
      }
    }


    // Show remaining brands
    const remainingBrands = await Brand.find({});
    remainingBrands.forEach(brand => {
    });

    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
};

cleanBrands();

