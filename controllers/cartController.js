const Cart = require("../models/Cart");
const Product = require("../models/Product");

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function coerceProductColorName(colorEntry) {
  if (typeof colorEntry === "string") return colorEntry;
  if (colorEntry && typeof colorEntry === "object" && colorEntry.name) return colorEntry.name;
  return "";
}

function matchCanonicalColor(product, requestedColor) {
  const requestedNormalized = normalizeText(requestedColor);
  const productColors = Array.isArray(product?.colors) ? product.colors : [];

  for (const entry of productColors) {
    const name = coerceProductColorName(entry);
    if (!name) continue;
    if (normalizeText(name) === requestedNormalized) {
      return name;
    }
  }

  return "";
}

// @desc    Get user cart
// @route   GET /api/cart
// @access  Private
exports.getCart = async (req, res, next) => {
  try {
    let cart = await Cart.findOne({ user: req.user.id }).populate(
      "items.product",
      "name images price originalPrice discount category colors sizes slug stock isActive isComboOffer comboPrice comboDiscount freeDelivery freeDeliveryMinQty"
    );

    if (!cart) {
      cart = await Cart.create({ user: req.user.id, items: [] });
    }

    // Filter out items where product is null (deleted) or inactive
    const originalItemCount = cart.items.length;
    cart.items = cart.items.filter((item) => {
      // Remove if product was deleted (null)
      if (!item.product) {
        return false;
      }
      // Remove if product is inactive
      if (item.product.isActive === false) {
        return false;
      }
      return true;
    });

    // Save cart if items were removed
    if (cart.items.length < originalItemCount) {
      await cart.save();
    }

    res.status(200).json({
      success: true,
      cart,
      itemsRemoved: originalItemCount - cart.items.length,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add item to cart
// @route   POST /api/cart
// @access  Private
exports.addToCart = async (req, res, next) => {
  try {
    const { productId, quantity, size, color } = req.body;

    // Validate product
    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Check stock
    if (product.stock < quantity) {
      return res.status(400).json({
        success: false,
        message: "Insufficient stock",
      });
    }

    // Check if size and color are valid
    if (!product.sizes.includes(size)) {
      return res.status(400).json({
        success: false,
        message: "Invalid size",
      });
    }

    const canonicalColor = matchCanonicalColor(product, color);
    if (!canonicalColor) {
      return res.status(400).json({
        success: false,
        message: "Invalid color",
      });
    }

    // Find or create cart
    let cart = await Cart.findOne({ user: req.user.id });

    if (!cart) {
      cart = await Cart.create({ user: req.user.id, items: [] });
    }

    // Check if item already exists
    const existingItemIndex = cart.items.findIndex(
      (item) =>
        item.product.toString() === productId &&
        item.size === size &&
        normalizeText(item.color) === normalizeText(canonicalColor)
    );

    if (existingItemIndex > -1) {
      // Update quantity
      cart.items[existingItemIndex].quantity += quantity;
    } else {
      // Add new item
      cart.items.push({
        product: productId,
        quantity,
        size,
        color: canonicalColor,
        price: product.price,
      });
    }

    await cart.save();
    await cart.populate(
      "items.product",
      "name images price originalPrice discount category colors sizes slug stock isActive isComboOffer comboPrice comboDiscount freeDelivery freeDeliveryMinQty"
    );

    res.status(200).json({
      success: true,
      cart,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update cart item
// @route   PUT /api/cart/:itemId
// @access  Private
exports.updateCartItem = async (req, res, next) => {
  try {
    const { quantity } = req.body;
    const cart = await Cart.findOne({ user: req.user.id });

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    const item = cart.items.id(req.params.itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found in cart",
      });
    }

    // Check stock
    const product = await Product.findById(item.product);
    if (product.stock < quantity) {
      return res.status(400).json({
        success: false,
        message: "Insufficient stock",
      });
    }

    item.quantity = quantity;
    await cart.save();
    await cart.populate(
      "items.product",
      "name images price originalPrice discount category colors sizes slug stock isActive isComboOffer comboPrice comboDiscount freeDelivery freeDeliveryMinQty"
    );

    res.status(200).json({
      success: true,
      cart,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Remove item from cart
// @route   DELETE /api/cart/:itemId
// @access  Private
exports.removeFromCart = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.user.id });

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    cart.items = cart.items.filter(
      (item) => item._id.toString() !== req.params.itemId
    );

    await cart.save();
    await cart.populate(
      "items.product",
      "name images price originalPrice discount category colors sizes slug stock isActive isComboOffer comboPrice comboDiscount freeDelivery freeDeliveryMinQty"
    );

    res.status(200).json({
      success: true,
      cart,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Clear cart
// @route   DELETE /api/cart
// @access  Private
exports.clearCart = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.user.id });

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    cart.items = [];
    await cart.save();

    res.status(200).json({
      success: true,
      cart,
    });
  } catch (error) {
    next(error);
  }
};
