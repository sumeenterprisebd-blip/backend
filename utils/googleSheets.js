class GoogleSheetsService {
  constructor() {
    this.auth = null;
    this.sheets = null;
    this.spreadsheetId = process.env.GOOGLE_SHEET_ID;
    this.initialized = false;
  }

  /**
   * Initialize Google Sheets API with service account credentials
   */
  async initialize() {
    try {
      if (this.initialized) return true;

      // Lazy-load googleapis to reduce cold-start overhead and avoid import-time errors
      let google;
      try {
        ({ google } = require('googleapis'));
      } catch (e) {
        return false;
      }

      // Check if credentials are provided
      if (
        !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
        !process.env.GOOGLE_PRIVATE_KEY
      ) {
        return false;
      }

      if (!this.spreadsheetId) {
        return false;
      }

      // Create auth client with service account
      this.auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        },
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });

      this.sheets = google.sheets({ version: "v4", auth: this.auth });

      // Verify sheet exists and is accessible
      try {
        await this.sheets.spreadsheets.get({
          spreadsheetId: this.spreadsheetId,
        });
      } catch (verifyError) {
        this.initialized = false;
        return false;
      }

      this.initialized = true;
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if service is ready to use
   */
  isReady() {
    return this.initialized && this.sheets && this.spreadsheetId;
  }

  /**
   * Ensure headers exist in the sheet
   */
  async ensureHeaders() {
    if (!this.isReady()) return false;

    try {
      const headers = [
        "Order ID",
        "Customer Name",
        "Mobile Number",
        "Address",
        "Product Name",
        "Quantity",
        "Color",
        "Size",
        "Total Bill",
        "Order Time",
        "Order Status",
        "Payment Method",
        "Note",
        "Synced At",
      ];

      // Check if headers exist
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: "A1:N1",
      });

      // If no headers, add them
      if (!response.data.values || response.data.values.length === 0) {
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: "A1:N1",
          valueInputOption: "RAW",
          resource: {
            values: [headers],
          },
        });

        // Format header row
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          resource: {
            requests: [
              {
                repeatCell: {
                  range: {
                    sheetId: 0,
                    startRowIndex: 0,
                    endRowIndex: 1,
                  },
                  cell: {
                    userEnteredFormat: {
                      backgroundColor: { red: 0.2, green: 0.5, blue: 0.8 },
                      textFormat: {
                        foregroundColor: { red: 1, green: 1, blue: 1 },
                        fontSize: 11,
                        bold: true,
                      },
                    },
                  },
                  fields: "userEnteredFormat(backgroundColor,textFormat)",
                },
              },
            ],
          },
        });
      }

      return true;
    } catch (error) {
      if (error.message.includes("not found")) {
      } else {
      }
      return false;
    }
  }

  /**
   * Check if order already exists in sheet (prevent duplicates)
   */
  async orderExists(orderId) {
    if (!this.isReady()) return false;

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: "A:A", // Check Order ID column
      });

      if (!response.data.values) return false;

      return response.data.values.some((row) => row[0] === orderId);
    } catch (error) {
      if (error.message.includes("not found")) {
      } else {
      }
      return false;
    }
  }

  /**
   * Format order data for Google Sheets
   */
  formatOrderForSheet(order) {
    const rows = [];
    const customerName = `${order.shippingAddress?.firstName || ""} ${order.shippingAddress?.lastName || ""
      }`.trim();
    const mobileNumber = order.shippingAddress?.phone || "N/A";
    const address =
      [
        order.shippingAddress?.streetAddress,
        order.shippingAddress?.townCity,
        order.shippingAddress?.state,
        order.shippingAddress?.zipCode,
      ]
        .filter(Boolean)
        .join(", ") || "N/A";

    // Create a row for each order item
    order.orderItems?.forEach((item) => {
      rows.push([
        order._id.toString(),
        customerName,
        mobileNumber,
        address,
        item.name || "N/A",
        item.quantity || 0,
        item.color || "N/A",
        item.size || "N/A",
        `৳${order.total?.toFixed(2) || "0.00"}`,
        new Date(order.createdAt).toLocaleString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        order.orderStatus || "pending",
        order.paymentMethod || "N/A",
        order.notes || "N/A",
        new Date().toISOString(),
      ]);
    });

    return rows;
  }

  /**
   * Sync a single order to Google Sheets
   * @param {Object} order - Order document from MongoDB
   * @param {Object} Order - Order model for updating sync status
   */
  async syncOrder(order, Order = null) {
    if (!this.isReady()) {
      return { success: false, message: "Google Sheets not configured" };
    }

    try {
      await this.ensureHeaders();

      // Check if already synced in database
      if (order.syncedToSheet) {
        return {
          success: true,
          message: "Order already synced",
          skipped: true,
        };
      }

      // Check for duplicates in sheet (backup check)
      const exists = await this.orderExists(order._id.toString());
      if (exists) {
        // Mark as synced in database if not already marked
        if (Order && !order.syncedToSheet) {
          try {
            await Order.findByIdAndUpdate(order._id, {
              syncedToSheet: true,
              syncedAt: new Date(),
            });
          } catch (dbError) {
          }
        }

        return {
          success: true,
          message: "Order already synced",
          skipped: true,
        };
      }

      // Format order data
      const rows = this.formatOrderForSheet(order);

      // Append to sheet
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: "A:N",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        resource: {
          values: rows,
        },
      });

      // Mark order as synced in database
      if (Order) {
        try {
          await Order.findByIdAndUpdate(order._id, {
            syncedToSheet: true,
            syncedAt: new Date(),
          });
        } catch (dbError) {
        }
      }

      return {
        success: true,
        message: "Order synced successfully",
        rowsAdded: rows.length,
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Sync multiple orders to Google Sheets
   * @param {Array} orders - Array of order documents
   * @param {Object} Order - Order model for updating sync status
   */
  async syncOrders(orders, Order = null) {
    if (!this.isReady()) {
      return { success: false, message: "Google Sheets not configured" };
    }

    try {
      await this.ensureHeaders();

      let syncedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      const syncedOrderIds = [];

      for (const order of orders) {
        const result = await this.syncOrder(order, Order);
        if (result.success) {
          if (result.skipped) {
            skippedCount++;
          } else {
            syncedCount++;
            syncedOrderIds.push(order._id);
          }
        } else {
          failedCount++;
        }
      }

      return {
        success: true,
        message: `Synced ${syncedCount} orders, skipped ${skippedCount}, failed ${failedCount}`,
        synced: syncedCount,
        skipped: skippedCount,
        failed: failedCount,
        syncedOrderIds,
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Sync orders filtered by date
   */
  async syncOrdersByDate(orders, date) {
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    const filteredOrders = orders.filter((order) => {
      const orderDate = new Date(order.createdAt);
      orderDate.setHours(0, 0, 0, 0);
      return orderDate.getTime() === targetDate.getTime();
    });

    return await this.syncOrders(filteredOrders);
  }

  getColumnLetter(index) {
    let dividend = index + 1;
    let columnName = "";

    while (dividend > 0) {
      const modulo = (dividend - 1) % 26;
      columnName = String.fromCharCode(65 + modulo) + columnName;
      dividend = Math.floor((dividend - modulo) / 26);
    }

    return columnName;
  }

  /**
   * Ensure a sheet tab exists and headers are present
   */
  async ensureSheetTab(sheetTitle, headers = []) {
    if (!this.isReady()) return null;

    let sheetId = await this.getSheetId(sheetTitle);

    if (sheetId === null) {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          requests: [
            {
              addSheet: {
                properties: { title: sheetTitle },
              },
            },
          ],
        },
      });

      sheetId = await this.getSheetId(sheetTitle);
    }

    if (headers.length > 0) {
      const endCol = this.getColumnLetter(headers.length - 1);
      const headerRange = `${sheetTitle}!A1:${endCol}1`;

      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: headerRange,
      });

      const existing = response.data.values?.[0] || [];
      const hasHeader = existing.some((cell) => String(cell || "").trim() !== "");

      if (!hasHeader) {
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: headerRange,
          valueInputOption: "RAW",
          resource: { values: [headers] },
        });
      }
    }

    return sheetId;
  }

  /**
   * Append rows to a fixed sheet tab
   */
  async appendToSheet(sheetTitle, headers, rows) {
    if (!this.isReady()) {
      throw new Error("Google Sheets service is not initialized");
    }

    const sheetId = await this.ensureSheetTab(sheetTitle, headers);

    if (!rows || rows.length === 0) {
      return {
        success: true,
        sheetTitle,
        sheetUrl: `https://docs.google.com/spreadsheets/d/${this.spreadsheetId}/edit#gid=${sheetId}`,
        rowCount: 0,
      };
    }

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetTitle}!A1`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      resource: { values: rows },
    });

    return {
      success: true,
      sheetTitle,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${this.spreadsheetId}/edit#gid=${sheetId}`,
      rowCount: rows.length,
    };
  }

  /**
   * Export bulk data to a new sheet tab
   */
  async exportBulkData(data) {
    if (!this.isReady()) {
      throw new Error("Google Sheets service is not initialized");
    }

    try {
      // Create a new sheet tab with timestamp
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, -5);
      const sheetTitle = `Export_${timestamp}`;

      // Add new sheet
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetTitle,
                },
              },
            },
          ],
        },
      });

      // Write data to the new sheet
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetTitle}!A1`,
        valueInputOption: "RAW",
        resource: {
          values: data,
        },
      });

      // Format header row (bold, background color)
      const sheetId = await this.getSheetId(sheetTitle);
      if (sheetId !== null) {
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          resource: {
            requests: [
              {
                repeatCell: {
                  range: {
                    sheetId: sheetId,
                    startRowIndex: 0,
                    endRowIndex: 1,
                  },
                  cell: {
                    userEnteredFormat: {
                      backgroundColor: {
                        red: 0.2,
                        green: 0.2,
                        blue: 0.8,
                      },
                      textFormat: {
                        foregroundColor: {
                          red: 1.0,
                          green: 1.0,
                          blue: 1.0,
                        },
                        fontSize: 11,
                        bold: true,
                      },
                    },
                  },
                  fields: "userEnteredFormat(backgroundColor,textFormat)",
                },
              },
              {
                autoResizeDimensions: {
                  dimensions: {
                    sheetId: sheetId,
                    dimension: "COLUMNS",
                    startIndex: 0,
                    endIndex: 20,
                  },
                },
              },
            ],
          },
        });
      }

      const sheetUrl = `https://docs.google.com/spreadsheets/d/${this.spreadsheetId}/edit#gid=${sheetId}`;

      return {
        success: true,
        sheetTitle,
        sheetUrl,
        rowCount: data.length - 1,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get sheet ID by title
   */
  async getSheetId(sheetTitle) {
    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

      const sheet = response.data.sheets.find(
        (s) => s.properties.title === sheetTitle
      );

      return sheet ? sheet.properties.sheetId : null;
    } catch (error) {
      return null;
    }
  }
}

// Create singleton instance
const googleSheetsService = new GoogleSheetsService();

module.exports = googleSheetsService;
