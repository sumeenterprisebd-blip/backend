const Brand = require('../models/Brand');

// Get all brands (public - for frontend display)
exports.getBrands = async (req, res) => {
  try {
    // Only get brands that are active and have valid name and logo
    const brands = await Brand.find({ 
      isActive: true,
      name: { $exists: true, $ne: '', $not: /^\s*$/ }, // Must have a non-empty name
      logo: { $exists: true, $ne: '', $not: /^\s*$/ }  // Must have a non-empty logo
    })
      .sort({ displayOrder: 1, createdAt: -1 })
      .select('name logo _id') // Only return essential fields
      .lean(); // Use lean() for better performance
    
    // Remove duplicates by _id and by name (case-insensitive)
    const seenIds = new Set();
    const seenNames = new Set();
    const uniqueBrands = brands.filter((brand) => {
      const id = brand._id.toString();
      const nameLower = brand.name ? brand.name.toLowerCase().trim() : '';
      
      // Skip if duplicate ID or duplicate name
      if (seenIds.has(id) || seenNames.has(nameLower) || !nameLower || !brand.logo) {
        return false;
      }
      
      seenIds.add(id);
      seenNames.add(nameLower);
      return true;
    });
    
    // Set aggressive cache headers for brands
    res.set('Cache-Control', 'public, max-age=600, stale-while-revalidate=1200');
    
    res.json({
      success: true,
      count: uniqueBrands.length,
      brands: uniqueBrands
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching brands',
      error: error.message
    });
  }
};

// Get all brands (admin - includes inactive and press releases)
exports.getAllBrands = async (req, res) => {
  try {
    const brands = await Brand.find()
      .sort({ displayOrder: 1, createdAt: -1 });
    
    res.json({
      success: true,
      count: brands.length,
      brands
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching brands',
      error: error.message
    });
  }
};

// Get single brand by ID
exports.getBrandById = async (req, res) => {
  try {
    const brand = await Brand.findById(req.params.id);
    
    if (!brand) {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }
    
    res.json({
      success: true,
      brand
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching brand',
      error: error.message
    });
  }
};

// Create new brand
exports.createBrand = async (req, res) => {
  try {
    const { name, logo, website, description, pressRelease, isActive, displayOrder } = req.body;
    
    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Brand name is required'
      });
    }
    
    if (!logo || !logo.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Brand logo is required'
      });
    }
    
    // Check if brand with same name already exists (case-insensitive)
    const existingBrand = await Brand.findOne({ 
      name: { $regex: new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } 
    });
    
    if (existingBrand) {
      return res.status(400).json({
        success: false,
        message: 'Brand with this name already exists'
      });
    }
    
    // Validate logo URL format
    try {
      new URL(logo.trim());
    } catch (e) {
      return res.status(400).json({
        success: false,
        message: 'Invalid logo URL format'
      });
    }
    
    const brand = new Brand({
      name: name.trim(),
      logo: logo.trim(),
      website: website ? website.trim() : '',
      description: description ? description.trim() : '',
      pressRelease: pressRelease || {
        title: '',
        content: '',
        publishedDate: null,
        isPublished: false
      },
      isActive: isActive !== undefined ? isActive : true,
      displayOrder: displayOrder || 0
    });
    
    await brand.save();
    
    res.status(201).json({
      success: true,
      message: 'Brand created successfully',
      brand
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating brand',
      error: error.message
    });
  }
};

// Update brand
exports.updateBrand = async (req, res) => {
  try {
    const { name, logo, website, description, pressRelease, isActive, displayOrder } = req.body;
    
    const brand = await Brand.findById(req.params.id);
    
    if (!brand) {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }
    
    if (name) brand.name = name;
    if (logo) brand.logo = logo;
    if (website !== undefined) brand.website = website;
    if (description !== undefined) brand.description = description;
    if (pressRelease) {
      brand.pressRelease = {
        ...brand.pressRelease,
        ...pressRelease
      };
      // If publishing, set published date
      if (pressRelease.isPublished && !brand.pressRelease.publishedDate) {
        brand.pressRelease.publishedDate = new Date();
      }
    }
    if (isActive !== undefined) brand.isActive = isActive;
    if (displayOrder !== undefined) brand.displayOrder = displayOrder;
    
    await brand.save();
    
    res.json({
      success: true,
      message: 'Brand updated successfully',
      brand
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating brand',
      error: error.message
    });
  }
};

// Delete brand
exports.deleteBrand = async (req, res) => {
  try {
    const brand = await Brand.findById(req.params.id);
    
    if (!brand) {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }
    
    await brand.deleteOne();
    
    res.json({
      success: true,
      message: 'Brand deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting brand',
      error: error.message
    });
  }
};

// Get published press releases
exports.getPressReleases = async (req, res) => {
  try {
    const brands = await Brand.find({
      isActive: true,
      'pressRelease.isPublished': true
    })
      .select('name logo pressRelease')
      .sort({ 'pressRelease.publishedDate': -1 });
    
    const pressReleases = brands
      .filter(brand => brand.pressRelease && brand.pressRelease.title)
      .map(brand => ({
        brandId: brand._id,
        brandName: brand.name,
        brandLogo: brand.logo,
        title: brand.pressRelease.title,
        content: brand.pressRelease.content,
        publishedDate: brand.pressRelease.publishedDate
      }));
    
    res.json({
      success: true,
      count: pressReleases.length,
      pressReleases
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching press releases',
      error: error.message
    });
  }
};

