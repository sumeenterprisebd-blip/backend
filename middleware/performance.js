// Performance monitoring middleware
// Tracks request duration and logs slow requests

const performanceMiddleware = (req, res, next) => {
  const start = process.hrtime.bigint();
  
  // Store original end function
  const originalEnd = res.end;
  
  // Override end function to measure performance
  res.end = function(...args) {
    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1000000; // Convert to milliseconds
    
    // Add performance header
    res.setHeader('X-Response-Time', `${duration.toFixed(2)}ms`);
    
    // Log slow requests (>300ms)
    if (duration > 300) {
      console.warn(`⚠️  SLOW REQUEST: ${req.method} ${req.path} - ${duration.toFixed(2)}ms`);
      
      // Log query details for analysis
      if (Object.keys(req.query).length > 0) {
        console.warn('   Query params:', JSON.stringify(req.query));
      }
    }
    
    // Log very slow requests (>1000ms) with more details
    if (duration > 1000) {
      console.error(`🐌 VERY SLOW REQUEST: ${req.method} ${req.path} - ${duration.toFixed(2)}ms`);
      console.error('   Headers:', {
        'user-agent': req.headers['user-agent'],
        'origin': req.headers['origin']
      });
    }
    
    // Call original end
    originalEnd.apply(res, args);
  };
  
  next();
};

module.exports = performanceMiddleware;
