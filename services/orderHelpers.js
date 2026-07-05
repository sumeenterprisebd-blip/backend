const Order = require("../models/Order");
const googleSheetsService = require("../utils/googleSheets");

/**
 * Sync order to Google Sheets (non-blocking)
 */
exports.syncOrderAsync = (order) => {
  googleSheetsService.initialize().then((initialized) => {
    if (initialized) {
      googleSheetsService.syncOrder(order, Order).catch((err) => {
      });
    }
  });
};

/**
 * Build export data for orders
 */
exports.buildExportData = (orders) => {
  const exportData = [
    [
      "Name",
      "Number",
      "Address",
      "Quantity",
      "Item",
      "Color",
      "Total Bill",
      "Item Size",
      "Note",
    ],
  ];

  orders.forEach((order) => {
    order.orderItems.forEach((item) => {
      exportData.push([
        `${order.shippingAddress?.firstName || ""} ${order.shippingAddress?.lastName || ""
          }`.trim(),
        order.shippingAddress?.phone || order.guestInfo?.phone || "N/A",
        `${order.shippingAddress?.streetAddress || ""}, ${order.shippingAddress?.townCity || ""
          }, ${order.shippingAddress?.state || ""} ${order.shippingAddress?.zipCode || ""
          }`.replace(/^[,\s]+|[,\s]+$/g, ""),
        item.quantity,
        item.name,
        item.color,
        `৳${order.total.toFixed(2)}`,
        item.size,
        order.notes || "N/A",
      ]);
    });
  });

  return exportData;
};

/**
 * Build tracking data response
 */
exports.buildTrackingData = (order) => {
  const hasPathao = Boolean(order?.pathaoConsignmentId || order?.pathaoOrderId);

  const mapOrderStatusToDeliveryStatus = (orderStatus) => {
    const s = String(orderStatus || "").toLowerCase();
    switch (s) {
      case "pending":
        return "placed";
      case "confirmed":
        return "confirmed";
      case "processing":
        return "confirmed";
      case "hold":
        return "confirmed";
      case "shipped":
        return "in_transit";
      case "delivered":
        return "delivered";
      case "paid_return":
        return "cancelled";
      case "cancelled":
        return "cancelled";
      default:
        return "placed";
    }
  };

  // Tracking UI is built around Pathao-like delivery statuses.
  // For non-Pathao orders (and for Pathao orders still stuck at initial 'placed'),
  // derive deliveryStatus from orderStatus so the timeline updates correctly after admin changes.
  const mappedFromOrderStatus = mapOrderStatusToDeliveryStatus(order.orderStatus);
  const rawDeliveryStatus = String(order.deliveryStatus || "").toLowerCase();
  const effectiveDeliveryStatus =
    hasPathao && rawDeliveryStatus && rawDeliveryStatus !== "placed"
      ? rawDeliveryStatus
      : mappedFromOrderStatus;

  return {
    orderId: order._id.toString().slice(-8).toUpperCase(),
    _id: order._id,
    orderDate: order.createdAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    orderStatus: order.orderStatus,
    deliveryStatus: effectiveDeliveryStatus,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    shippingAddress: {
      firstName: order.shippingAddress?.firstName,
      lastName: order.shippingAddress?.lastName,
      phone: order.shippingAddress?.phone,
      email: order.shippingAddress?.email,
      address: `${order.shippingAddress?.streetAddress || ""}`,
      city: order.shippingAddress?.townCity,
      state: order.shippingAddress?.state,
      postalCode: order.shippingAddress?.zipCode,
      country: order.shippingAddress?.country || "Bangladesh",
    },
    orderItems: order.orderItems,
    subtotal: order.subtotal,
    discount: order.discount,
    deliveryFee: order.deliveryFee,
    total: order.total,
    pathaoConsignmentId: order.pathaoConsignmentId,
    pathaoOrderId: order.pathaoOrderId,
    trackingHistory: order.trackingHistory || [],
    lastStatusUpdate: order.lastStatusUpdate || order.updatedAt,
    deliveredAt: order.deliveredAt,
    cancelledAt: order.cancelledAt,
  };
};
