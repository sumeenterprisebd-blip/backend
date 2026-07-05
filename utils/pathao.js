/**
 * Pathao API Integration Utility
 *
 * This module provides functions to interact with Pathao's delivery API
 * for creating orders, tracking shipments, and updating delivery status.
 *
 * IMPORTANT: Add your Pathao API credentials to .env file:
 * - PATHAO_API_URL=https://api-hermes.pathao.com/api/v1
 * - PATHAO_CLIENT_ID=your_client_id
 * - PATHAO_CLIENT_SECRET=your_client_secret
 * - PATHAO_USERNAME=your_username
 * - PATHAO_PASSWORD=your_password
 * - PATHAO_STORE_ID=your_store_id
 */

const axios = require("axios");

const DEFAULT_TIMEOUT_MS = Number(process.env.PATHAO_TIMEOUT_MS || 10000);

const normalizeBaseURL = (rawBaseURL) => {
  const trimmed = String(rawBaseURL || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "https://api-hermes.pathao.com/api/v1";

  // If caller already provided a versioned base, respect it.
  if (/\/api\/v\d+$/i.test(trimmed) || /\/aladdin\/api\/v\d+$/i.test(trimmed)) {
    return trimmed;
  }

  // Pathao has multiple base hosts depending on product (Hermes vs Courier API).
  // Make env configuration more forgiving by appending the expected path when missing.
  if (/courier-api/i.test(trimmed)) {
    return `${trimmed}/aladdin/api/v1`;
  }

  if (/api-hermes\.pathao\.com/i.test(trimmed)) {
    return `${trimmed}/api/v1`;
  }

  return trimmed;
};

class PathaoService {
  constructor() {
    this.baseURL = normalizeBaseURL(
      process.env.PATHAO_API_URL || "https://api-hermes.pathao.com/api/v1"
    );
    this.clientId = process.env.PATHAO_CLIENT_ID;
    this.clientSecret = process.env.PATHAO_CLIENT_SECRET;
    this.username = process.env.PATHAO_USERNAME;
    this.password = process.env.PATHAO_PASSWORD;
    this.storeId = process.env.PATHAO_STORE_ID;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  getBaseURL() {
    return this.baseURL;
  }

  /**
   * Check if Pathao authentication is configured
   */
  isAuthConfigured() {
    return !!(
      this.clientId &&
      this.clientSecret &&
      this.username &&
      this.password
    );
  }

  /**
   * Check if Pathao integration is fully configured (includes storeId for booking)
   */
  isConfigured() {
    return this.isAuthConfigured() && !!this.storeId;
  }

  /**
   * Get access token from Pathao API
   */
  async getAccessToken() {
    try {
      // Check if we have a valid token
      if (
        this.accessToken &&
        this.tokenExpiry &&
        Date.now() < this.tokenExpiry
      ) {
        return this.accessToken;
      }

      // Request new token
      const response = await axios.post(`${this.baseURL}/issue-token`, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        username: this.username,
        password: this.password,
        grant_type: "password",
      }, { timeout: DEFAULT_TIMEOUT_MS });

      // Pathao responses sometimes vary by environment; accept a couple shapes.
      this.accessToken = response?.data?.access_token || response?.data?.data?.access_token || null;
      if (!this.accessToken) {
        throw new Error("Token missing from Pathao response");
      }
      // Set expiry to 1 hour from now (adjust based on actual token expiry)
      this.tokenExpiry = Date.now() + 3600000;

      return this.accessToken;
    } catch (error) {
      const status = error?.response?.status;
      throw new Error(
        `Failed to authenticate with Pathao API${status ? ` (HTTP ${status})` : ""}`
      );
    }
  }

  /**
   * Create a delivery order in Pathao
   * @param {Object} orderData - Order details
   * @returns {Promise<Object>} Pathao order response
   */
  async createOrder(orderData) {
    try {
      if (!this.isConfigured()) {
        return null;
      }

      const token = await this.getAccessToken();

      const pathaoOrder = {
        store_id: this.storeId,
        merchant_order_id: orderData.orderId,
        recipient_name: `${orderData.shippingAddress.firstName} ${orderData.shippingAddress.lastName}`,
        recipient_phone: orderData.shippingAddress.phone,
        recipient_address: orderData.shippingAddress.streetAddress,
        recipient_city: orderData.shippingAddress.townCity || "Dhaka",
        recipient_zone: orderData.shippingAddress.state || "Dhaka",
        amount_to_collect:
          orderData.paymentMethod === "cash" ? orderData.total : 0,
        item_type: 1, // 1 = Parcel, 2 = Document
        item_weight: 0.5, // in kg, adjust based on your needs
        item_description: `Order #${orderData.orderId}`,
      };

      const response = await axios.post(`${this.baseURL}/orders`, pathaoOrder, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: DEFAULT_TIMEOUT_MS,
      });

      return {
        consignment_id: response.data.data.consignment_id,
        order_id: response.data.data.order_id,
        merchant_order_id: response.data.data.merchant_order_id,
      };
    } catch (error) {
      const status = error?.response?.status;
      throw new Error(
        `Failed to create order in Pathao${status ? ` (HTTP ${status})` : ""}`
      );
    }
  }

  /**
   * Map Pathao status to our internal delivery status
   * @param {string} pathaoStatus - Pathao order status
   * @returns {string} Internal delivery status
   */
  mapPathaoStatus(pathaoStatus) {
    const statusMap = {
      Pending: "placed",
      "Pickup Requested": "confirmed",
      "Picked Up": "picked_up",
      "On Hold": "in_transit",
      "In Transit": "in_transit",
      "Out for Delivery": "out_for_delivery",
      Delivered: "delivered",
      Cancelled: "cancelled",
      "Return Requested": "failed",
      Returned: "failed",
    };

    return statusMap[pathaoStatus] || "in_transit";
  }

  /**
   * Get cities/zones available for delivery
   */
  async getCities() {
    try {
      if (!this.isAuthConfigured()) {
        return [];
      }

      const token = await this.getAccessToken();

      // Pathao has differed across environments; try a couple known endpoints.
      const endpoints = ["/cities", "/city-list"];
      for (const endpoint of endpoints) {
        try {
          const response = await axios.get(`${this.baseURL}${endpoint}`, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: DEFAULT_TIMEOUT_MS,
          });
          const data = response?.data?.data;
          return data?.cities || data || [];
        } catch {
          // try next
        }
      }

      return [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Get zones for a specific city
   */
  async getZones(cityId) {
    try {
      if (!this.isAuthConfigured()) {
        return [];
      }

      const token = await this.getAccessToken();

      const endpoints = [
        `/cities/${cityId}/zones`,
        `/zone-list?city_id=${encodeURIComponent(cityId)}`,
      ];
      for (const endpoint of endpoints) {
        try {
          const response = await axios.get(`${this.baseURL}${endpoint}`, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: DEFAULT_TIMEOUT_MS,
          });
          const data = response?.data?.data;
          return data?.zones || data || [];
        } catch {
          // try next
        }
      }

      return [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Cancel a Pathao order
   */
  async cancelOrder(consignmentId) {
    try {
      if (!this.isAuthConfigured()) {
        return null;
      }

      const token = await this.getAccessToken();

      const response = await axios.post(
        `${this.baseURL}/orders/${consignmentId}/cancel`,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      return response.data;
    } catch (error) {

      throw new Error("Failed to cancel order in Pathao");
    }
  }
}

// Export singleton instance
module.exports = new PathaoService();
