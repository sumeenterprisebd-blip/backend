const Product = require("../models/Product");

/**
 * Validate shipping address fields
 */
exports.validateShippingAddress = (shippingAddress, isGuestOrder) => {
  if (
    !shippingAddress ||
    !shippingAddress.firstName ||
    !shippingAddress.phone ||
    !shippingAddress.streetAddress ||
    !shippingAddress.townCity
  ) {
    return {
      valid: false,
      message:
        "Complete shipping address is required (firstName, phone, streetAddress, townCity)",
    };
  }


  return { valid: true };
};

/**
 * Validate order items and calculate totals
 */
exports.validateOrderItems = async (orderItems) => {
  if (!orderItems || orderItems.length === 0) {
    return { valid: false, message: "Order items are required" };
  }

  const validatedOrderItems = [];
  let subtotal = 0;

  for (const item of orderItems) {
    const product = await Product.findById(item.product || item.productId);

    if (!product || !product.isActive) {
      return {
        valid: false,
        message: `Product ${item.name || "unknown"} is not available`,
      };
    }

    if (product.stock < item.quantity) {
      return {
        valid: false,
        message: `Insufficient stock for ${product.name}`,
      };
    }

    validatedOrderItems.push({
      product: product._id,
      name: product.name,
      image: item.image || product.images[0] || "/logo.jpeg",
      quantity: item.quantity,
      size: item.size,
      color: item.color,
      price: item.price || product.price,
    });

    subtotal += (item.price || product.price) * item.quantity;
  }

  return { valid: true, validatedOrderItems, subtotal };
};

/**
 * Calculate order totals
 */
exports.calculateTotals = (
  subtotal,
  discountPercent = 20,
  deliveryFee = 15
) => {
  const discount = subtotal * (discountPercent / 100);
  const total = subtotal - discount + deliveryFee;
  return { subtotal, discount, deliveryFee, total };
};
