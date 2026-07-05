const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const rateLimit = require("express-rate-limit");
const compression = require("compression");
const helmet = require("helmet");


// Load environment variables
dotenv.config();

// Defensive check for required environment variables
const requiredEnvVars = [
  "MONGODB_URI",
  "JWT_SECRET",
  "JWT_EXPIRE",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "FROM_EMAIL",
];
const missingEnvVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingEnvVars.length > 0) {
  // Log missing env vars and throw a clear error (do not crash, but log for debugging)
  // In production/serverless, do not throw, just log
  console.error(
    `\n[CONFIG ERROR] Missing required environment variables: ${missingEnvVars.join(", ")}`
  );
}

// Global handler for uncaught exceptions and unhandled rejections
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

console.log(`[START] server starting in ${process.env.NODE_ENV || 'development'} mode`);

// Set mongoose buffer timeout globally (prevent buffering timeout errors)
mongoose.set("bufferTimeoutMS", 30000);

// Import routes
const authRoutes = require("./routes/authRoutes");
const productRoutes = require("./routes/productRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const cartRoutes = require("./routes/cartRoutes");
const orderRoutes = require("./routes/orderRoutes");
const userRoutes = require("./routes/userRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const favoriteRoutes = require("./routes/favoriteRoutes");
const contactRoutes = require("./routes/contactRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const brandRoutes = require("./routes/brandRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const colorRoutes = require("./routes/colorRoutes");
const measurementRoutes = require("./routes/measurementRoutes");
const campaignRoutes = require("./routes/campaignRoutes");
const heroRoutes = require("./routes/heroRoutes");
const likeRoutes = require("./routes/likeRoutes");
const popupRoutes = require("./routes/popupRoutes");
const facebookVideoRoutes = require("./routes/facebookVideoRoutes");
const adminAnalyticsRoutes = require("./routes/adminAnalyticsRoutes");
const advanceRoutes = require("./routes/advanceRoutes");
const adminAdvanceRoutes = require("./routes/adminAdvanceRoutes");
const pathaoRoutes = require("./routes/pathaoRoutes");
const pushRoutes = require("./routes/pushRoutes");
const blacklistRoutes = require("./routes/blacklistRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const adminNotificationRoutes = require("./routes/adminNotificationRoutes");
const searchRoutes = require("./routes/searchRoutes");
const seoRoutes = require("./routes/seoRoutes");
const adminPaymentSettingsRoutes = require("./routes/adminPaymentSettingsRoutes");
const sslcommerzRoutes = require("./routes/sslcommerzRoutes");

// Import middleware
const errorHandler = require("./middleware/errorHandler");
const { cacheMiddleware, CACHE_DURATION } = require("./middleware/cache");
const performanceMiddleware = require("./middleware/performance");

// Import Google Sheets service (for initialization)
const googleSheetsService = require("./utils/googleSheets");

const app = express();

// Small perf/security win; does not affect app behavior
app.disable('x-powered-by');

// Trust proxy - Required for Vercel/serverless deployments
// This allows Express to correctly identify client IPs from X-Forwarded-For header
// Essential for rate limiting and logging accurate client information
app.set('trust proxy', 1); // Trust first proxy (Vercel)

// Normalize and collect allowed origins from env/defaults
const normalizeOrigin = (value) => {
  if (!value) return "";
  return value.trim().replace(/\/+$/, "");
};

const getAllowedOrigins = () => {
  const configuredOrigins = (process.env.FRONTEND_URL || process.env.CORS_ORIGINS || "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);

  const defaults = [
    process.env.FRONTEND_URL,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "https://sumetraders.com",
    "https://www.sumetraders.com",
  ].map(normalizeOrigin).filter(Boolean);

  return [...new Set([...configuredOrigins, ...defaults])];
};

const allowedOrigins = getAllowedOrigins();
const isAllowedOrigin = (origin) => {
  if (!origin) return true;

  const normalizedOrigin = normalizeOrigin(origin);
  if (allowedOrigins.includes(normalizedOrigin)) return true;

  if (process.env.NODE_ENV === "development") {
    if (normalizedOrigin.includes("localhost") || normalizedOrigin.includes("127.0.0.1")) {
      return true;
    }
  }

  if (normalizedOrigin.includes("vercel.app")) return true;
  if (normalizedOrigin.includes("deshwear.shop")) return true;
  if (normalizedOrigin.includes("sumetraders.com")) return true;

  return false;
};

// CORS configuration - Must be before other middleware
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, Postman, or same-origin)
    if (!origin) return callback(null, true);

    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "Access-Control-Request-Method",
    "Access-Control-Request-Headers",
  ],
  exposedHeaders: ["Content-Range", "X-Content-Range"],
  preflightContinue: false,
  optionsSuccessStatus: 204,
  maxAge: 86400, // 24 hours
};

// Enable compression for all responses (gzip/brotli via Vercel, deflate/gzip for local)
// Must be placed early in middleware chain
app.use(compression({
  filter: (req, res) => {
    // Compress all responses except for already compressed files
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  // Prefer lower CPU cost over maximum compression on serverless.
  // Higher levels can increase TTFB and hurt Lighthouse more than they help.
  level: 6,
  threshold: 1024, // Compress responses larger than 1 KiB
  memLevel: 8, // Memory optimization
}));

// Security headers with helmet (optimized for performance)
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP to avoid conflicts with Next.js
  crossOriginEmbedderPolicy: false,
}));


// ...existing code...

// Performance monitoring middleware
app.use(performanceMiddleware);

// Response time tracking middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 500) {
      // Log slow requests for monitoring
    }
  });
  next();
});


// Apply CORS first (before rate limiting for preflight requests)
app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options("*", cors(corsOptions));

// Additional CORS headers middleware for Vercel (fallback)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, PATCH, OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With, Accept, Origin"
    );
  }
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

// Rate limiting (skip for OPTIONS requests and more lenient in development)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "production" ? 100 : 1000, // More lenient in development
  skip: (req) => {
    // Skip rate limiting for preflight, public settings, and static files
    return (
      req.method === "OPTIONS" ||
      req.path === "/api/settings" ||
      req.path.startsWith("/uploads/") ||
      req.path.startsWith("/_next/") ||
      req.path.includes("/public/")
    );
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Middleware
app.use(limiter);
app.use(express.json({ limit: "10mb" })); // Increased limit for base64 image uploads
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Serve static files from public/uploads directory with cache headers
app.use("/uploads", express.static("public/uploads", {
  maxAge: '1y', // Cache static uploads for 1 year
  immutable: true,
  etag: true,
  lastModified: true,
}));
// Health check endpoint (with cache to avoid DB hits)
app.get("/api/health", (req, res) => {
  res.set('Cache-Control', 'public, max-age=60'); // Cache for 1 minute
  res.status(200).json({
    status: "OK",
    message: "DeshWear Backend API is running",
    timestamp: new Date().toISOString(),
    compression: req.acceptsEncodings('gzip', 'deflate') || 'none',
  });
});

// API Routes with caching for public endpoints
app.use("/api/auth", authRoutes);
app.use("/api/pathao", pathaoRoutes);
app.use("/api/products", cacheMiddleware(CACHE_DURATION.short), productRoutes);
app.use("/api/search", cacheMiddleware(CACHE_DURATION.short), searchRoutes);
app.use("/api/seo", cacheMiddleware(CACHE_DURATION.long), seoRoutes);
app.use("/api/categories", cacheMiddleware(CACHE_DURATION.long), categoryRoutes);
app.use("/api/measurements", cacheMiddleware(CACHE_DURATION.long), measurementRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments/sslcommerz", sslcommerzRoutes);
app.use("/api/users", userRoutes);
app.use("/api/reviews", cacheMiddleware(CACHE_DURATION.medium), reviewRoutes);
app.use("/api/favorites", favoriteRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/brands", cacheMiddleware(CACHE_DURATION.long), brandRoutes);
// Settings include tracking IDs that must propagate quickly after admin updates.
// Keep cache short to avoid stale tracking configuration across devices/browsers.
app.use("/api/settings", cacheMiddleware(CACHE_DURATION.short), settingsRoutes);
app.use("/api/colors", cacheMiddleware(CACHE_DURATION.veryLong), colorRoutes);
app.use("/api/campaigns", cacheMiddleware(CACHE_DURATION.medium), campaignRoutes);
app.use("/api/heroes", cacheMiddleware(CACHE_DURATION.medium), heroRoutes);
app.use("/api/likes", likeRoutes);
app.use("/api/popup", cacheMiddleware(CACHE_DURATION.long), popupRoutes);
app.use("/api/facebook-videos", cacheMiddleware(CACHE_DURATION.medium), facebookVideoRoutes);
app.use("/api/admin/analytics", adminAnalyticsRoutes);
app.use("/api/admin/payment-settings", adminPaymentSettingsRoutes);
app.use("/api/admin", adminAdvanceRoutes);
app.use("/api/advance", advanceRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/blacklist", blacklistRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin/notifications", adminNotificationRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// MongoDB connection with caching for serverless
let cachedDb = null;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 5;

const connectDB = async (attempt = 1) => {
  // If already connected, return the cached connection
  if (cachedDb && mongoose.connection.readyState === 1) {
    return true;
  }

  try {
    console.log(`[DB] connectDB attempt ${attempt}`);
    // Check if MONGODB_URI is defined
    if (!process.env.MONGODB_URI) {
      return false;
    }

    // If mongoose is already connecting, wait for it
    if (mongoose.connection.readyState === 2) {
      // Wait for connection to be established
      await new Promise((resolve) => {
        mongoose.connection.once("connected", resolve);
      });
      cachedDb = mongoose.connection;
      return true;
    }

    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000, // Reduced to 10s for faster failures
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000, // Reduced to 10s
      maxPoolSize: 20, // Increased for better concurrency
      minPoolSize: 5, // Increased minimum pool
      // Improve connection resilience for serverless
      retryWrites: true,
      retryReads: true,
      maxIdleTimeMS: 10000, // Reduced idle time
      family: 4, // Use IPv4 only to avoid dual-stack issues
      // Performance optimizations
      autoIndex: false, // Disable auto-index for speed
      compressors: ['zlib'], // Enable MongoDB wire protocol compression
      // Additional performance settings
      readPreference: 'primaryPreferred', // Faster reads
      w: 'majority', // Write concern
      journal: true, // Journaling for safety
    });

    cachedDb = conn.connection;
    connectionAttempts = 0; // Reset attempts on success
    console.log('[DB] connected');
    return true;
  } catch (error) {
    console.error('[DB] connection error:', error && error.message ? error.message : error);
    cachedDb = null;

    // Retry logic with exponential backoff
    if (attempt < MAX_CONNECTION_ATTEMPTS) {
      const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s, 8s
      await new Promise((resolve) => setTimeout(resolve, delay));
      return connectDB(attempt + 1);
    }

    return false;
  }
};


// Middleware to ensure DB connection on each request (for serverless)
app.use(async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    await connectDB();
  }
  next();
});

// Start server
const PORT = process.env.PORT || 5000;

// Initialize DB connection
connectDB().then((connected) => {
  if (connected) {
    // Initialize Google Sheets service (optional, non-blocking)
    googleSheetsService.initialize().catch((err) => {
    });
  }

  // For Vercel serverless, don't call app.listen()
  // The serverless function will handle requests
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    app.listen(PORT, () => {
      // Server started
    });
  }
});

module.exports = app;

