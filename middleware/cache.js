// Simple in-memory cache middleware for faster responses
// Reduces database queries and improves server response time

const cache = new Map();
const CACHE_DURATION = {
  short: 60 * 1000,        // 1 minute
  medium: 5 * 60 * 1000,   // 5 minutes
  long: 15 * 60 * 1000,    // 15 minutes
  veryLong: 60 * 60 * 1000 // 1 hour
};

// Cache middleware factory
const cacheMiddleware = (duration = CACHE_DURATION.short) => {
  return (req, res, next) => {
    // Skip cache for non-GET requests or authenticated requests
    if (req.method !== 'GET' || req.headers.authorization) {
      return next();
    }

    // Create cache key from URL and query params
    // Include baseUrl to avoid collisions between mounted routers (e.g. /api/settings vs /api/products)
    const cacheKey = `${req.baseUrl || ""}${req.path}${JSON.stringify(req.query)}`;

    // Check if cached response exists and is still valid
    const cached = cache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) {
      // Set cache headers
      res.set('X-Cache', 'HIT');
      res.set('Cache-Control', `public, max-age=${Math.floor(duration / 1000)}`);
      return res.status(200).json(cached.data);
    }

    // Store original res.json
    const originalJson = res.json.bind(res);

    // Override res.json to cache the response
    res.json = function (data) {
      // Only cache successful responses
      if (res.statusCode === 200) {
        cache.set(cacheKey, {
          data,
          expiry: Date.now() + duration
        });
      }
      res.set('X-Cache', 'MISS');
      res.set('Cache-Control', `public, max-age=${Math.floor(duration / 1000)}`);
      return originalJson(data);
    };

    next();
  };
};

// Clear cache for specific pattern
const clearCache = (pattern) => {
  if (!pattern) {
    cache.clear();
    return;
  }

  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      cache.delete(key);
    }
  }
};

// Auto-cleanup old cache entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now >= value.expiry) {
      cache.delete(key);
    }
  }
}, 10 * 60 * 1000);

module.exports = {
  cacheMiddleware,
  clearCache,
  CACHE_DURATION
};
