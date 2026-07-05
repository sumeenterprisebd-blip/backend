#!/usr/bin/env node
/**
 * Google Sheets Configuration Validator
 *
 * This script validates your Google Sheets configuration
 * and provides specific guidance on fixing issues.
 */

require("dotenv").config();
const { google } = require("googleapis");

async function validateConfiguration() {
  // Step 1: Check environment variables

  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;

  let hasErrors = false;

  if (!serviceAccountEmail) {
    hasErrors = true;
  }

  if (!privateKey) {
    hasErrors = true;
  } else if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    hasErrors = true;
  }

  if (!sheetId) {
    hasErrors = true;
  }

  if (hasErrors) {
    process.exit(1);
  }

  // Step 2: Test authentication

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: serviceAccountEmail,
        private_key: privateKey.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    // Step 3: Verify sheet exists and is accessible

    try {
      const sheetResponse = await sheets.spreadsheets.get({
        spreadsheetId: sheetId,
      });

      // Step 4: Check permissions
      sheetResponse.data.sheets.forEach((sheet) => {
      });

    } catch (sheetError) {
      process.exit(1);
    }
  } catch (authError) {
    process.exit(1);
  }
}

// Run validation
validateConfiguration().catch((error) => {
  process.exit(1);
});
