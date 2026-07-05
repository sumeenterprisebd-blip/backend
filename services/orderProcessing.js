const Cart = require("../models/Cart");
const Product = require("../models/Product");

/**
 * Process authenticated user order from cart
 */
exports.processAuthUserOrder = async (userId, orderItems) => {
  const cart = await Cart.findOne({ user: userId }).populate("items.product");

  // If cart is empty but orderItems provided, use orderItems
  if (
    (!cart || cart.items.length === 0) &&
    orderItems &&
    orderItems.length > 0
  ) {
    return { useOrderItems: true };
  }

  if (!cart || cart.items.length === 0) {
    return {
      error:
        "Your cart is empty. Please add items to your cart before checking out.",
    };
  }

  const cartOrderItems = cart.items.map((item) => ({
    product: item.product._id,
    name: item.product.name,
    image: item.product.images[0] || "/logo.jpeg",
    quantity: item.quantity,
    size: item.size,
    color: item.color,
    price: item.price,
  }));

  const subtotal = cart.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  return { cartOrderItems, subtotal, cart };
};

/**
 * Update product stock after order
 */
exports.updateProductStock = async (orderItems) => {
  for (const item of orderItems) {
    await Product.findByIdAndUpdate(item.product, {
      $inc: { stock: -item.quantity },
    });
  }
};

/**
 * Clear user cart
 */
exports.clearUserCart = async (userId) => {
  const cart = await Cart.findOne({ user: userId });
  if (cart) {
    cart.items = [];
    await cart.save();
  }
};
