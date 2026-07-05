const Favorite = require('../models/Favorite');
const Product = require('../models/Product');

// @desc    Get user favorites
// @route   GET /api/favorites
// @access  Private
exports.getFavorites = async (req, res, next) => {
  try {
    const favorites = await Favorite.find({ user: req.user.id })
      .populate('product')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: favorites.length,
      favorites: favorites.map(fav => fav.product)
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add to favorites
// @route   POST /api/favorites
// @access  Private
exports.addToFavorites = async (req, res, next) => {
  try {
    const { productId } = req.body;

    // Validate product
    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check if already favorited
    const existing = await Favorite.findOne({
      user: req.user.id,
      product: productId
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Product already in favorites'
      });
    }

    const favorite = await Favorite.create({
      user: req.user.id,
      product: productId
    });

    await favorite.populate('product');

    res.status(201).json({
      success: true,
      favorite: favorite.product
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Remove from favorites
// @route   DELETE /api/favorites/:productId
// @access  Private
exports.removeFromFavorites = async (req, res, next) => {
  try {
    const favorite = await Favorite.findOne({
      user: req.user.id,
      product: req.params.productId
    });

    if (!favorite) {
      return res.status(404).json({
        success: false,
        message: 'Favorite not found'
      });
    }

    await favorite.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Removed from favorites'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Check if product is favorited
// @route   GET /api/favorites/check/:productId
// @access  Private
exports.checkFavorite = async (req, res, next) => {
  try {
    const favorite = await Favorite.findOne({
      user: req.user.id,
      product: req.params.productId
    });

    res.status(200).json({
      success: true,
      isFavorited: !!favorite
    });
  } catch (error) {
    next(error);
  }
};

