const Cart = require("../models/Cart");
const Product = require("../models/Product");

const normalizePricingTiers = (tiers = []) => {
  if (!Array.isArray(tiers)) return [];

  return tiers
    .map((tier) => ({
      minQty: Number(tier?.minQty),
      maxQty: tier?.maxQty === "" || tier?.maxQty === null || tier?.maxQty === undefined ? null : Number(tier.maxQty),
      price: Number(tier?.price),
    }))
    .filter((tier) => Number.isFinite(tier.minQty) && tier.minQty > 0 && Number.isFinite(tier.price) && tier.price >= 0)
    .sort((a, b) => a.minQty - b.minQty);
};

const getEffectiveUnitPrice = (product, quantity = 1) => {
  const basePrice = Number(product?.price || 0);
  const safeQuantity = Math.max(1, Number(quantity) || 1);
  const tiers = normalizePricingTiers(product?.pricingTiers);

  let effectiveUnitPrice = basePrice;
  for (const tier of tiers) {
    const meetsMin = safeQuantity >= tier.minQty;
    const meetsMax = tier.maxQty === null || safeQuantity <= tier.maxQty;
    if (meetsMin && meetsMax) {
      effectiveUnitPrice = tier.price;
      break;
    }
  }

  return effectiveUnitPrice;
};

// @desc    Get user cart
// @route   GET /api/cart
// @access  Private
exports.getCart = async (req, res, next) => {
  try {
    let cart = await Cart.findOne({ user: req.user.id }).populate(
      "items.product",
      "name images price originalPrice discount category slug stock isActive isComboOffer comboPrice comboDiscount freeDelivery freeDeliveryMinQty"
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
    const { productId, quantity } = req.body;

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

    // Find or create cart
    let cart = await Cart.findOne({ user: req.user.id });

    if (!cart) {
      cart = await Cart.create({ user: req.user.id, items: [] });
    }

    // Check if item already exists
    const existingItemIndex = cart.items.findIndex(
      (item) => item.product.toString() === productId
    );

    const nextQuantity = existingItemIndex > -1
      ? cart.items[existingItemIndex].quantity + quantity
      : quantity;
    const effectivePrice = getEffectiveUnitPrice(product, nextQuantity);

    if (existingItemIndex > -1) {
      cart.items[existingItemIndex].quantity = nextQuantity;
      cart.items[existingItemIndex].price = effectivePrice;
    } else {
      cart.items.push({
        product: productId,
        quantity,
        price: effectivePrice,
      });
    }

    await cart.save();
    await cart.populate(
      "items.product",
      "name images price originalPrice discount category slug stock isActive isComboOffer comboPrice comboDiscount freeDelivery freeDeliveryMinQty"
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
    item.price = getEffectiveUnitPrice(product, item.quantity);
    await cart.save();
    await cart.populate(
      "items.product",
      "name images price originalPrice discount category slug stock isActive isComboOffer comboPrice comboDiscount freeDelivery freeDeliveryMinQty"
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
      "name images price originalPrice discount category slug stock isActive isComboOffer comboPrice comboDiscount freeDelivery freeDeliveryMinQty"
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
