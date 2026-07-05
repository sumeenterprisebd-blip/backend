const Hero = require("../models/Hero");
const { clearCache } = require("../middleware/cache");

const HERO_CACHE_KEYS = ["/api/heroes", "/api/heroes/active"];

const clearHeroCache = () => {
  HERO_CACHE_KEYS.forEach((key) => clearCache(key));
};

// @desc    Get all heroes (admin)
// @route   GET /api/heroes
// @access  Private/Admin
exports.getHeroes = async (req, res) => {
  try {
    const { status, active } = req.query;

    let query = {};

    if (status) {
      query.isActive = status === "active";
    }

    if (active !== undefined) {
      query.isActive = active === "true";
    }

    const heroes = await Hero.find(query)
      .sort({ priority: -1, createdAt: -1 })
      .select("-__v")
      .lean();

    // Set cache headers (disable caching for authenticated/admin requests)
    if (req.headers.authorization) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    } else {
      res.set('Cache-Control', 'public, max-age=180, stale-while-revalidate=300');
    }

    res.status(200).json({
      success: true,
      count: heroes.length,
      data: heroes,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch heroes",
      error: error.message,
    });
  }
};

// @desc    Get active heroes (public)
// @route   GET /api/heroes/active
// @access  Public
exports.getActiveHeroes = async (req, res) => {
  try {
    const heroes = await Hero.getActiveHeroes();

    // Track impressions for all active heroes
    if (heroes.length > 0) {
      await Promise.all(heroes.map((hero) => hero.trackImpression()));
    }

    // Set cache headers
    res.set('Cache-Control', 'public, max-age=180, stale-while-revalidate=300');

    res.status(200).json({
      success: true,
      count: heroes.length,
      data: heroes,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch active heroes",
      error: error.message,
    });
  }
};

// @desc    Get single hero
// @route   GET /api/heroes/:id
// @access  Private/Admin
exports.getHero = async (req, res) => {
  try {
    const hero = await Hero.findById(req.params.id);

    if (!hero) {
      return res.status(404).json({
        success: false,
        message: "Hero not found",
      });
    }

    if (req.headers.authorization) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }

    res.status(200).json({
      success: true,
      data: hero,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch hero",
      error: error.message,
    });
  }
};

// @desc    Create new hero
// @route   POST /api/heroes
// @access  Private/Admin
exports.createHero = async (req, res) => {
  try {
    const heroData = req.body;

    // Create hero
    const hero = await Hero.create(heroData);
    clearHeroCache();

    res.status(201).json({
      success: true,
      message: "Hero created successfully",
      data: hero,
    });
  } catch (error) {

    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: Object.values(error.errors).map((err) => err.message),
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to create hero",
      error: error.message,
    });
  }
};

// @desc    Update hero
// @route   PUT /api/heroes/:id
// @access  Private/Admin
exports.updateHero = async (req, res) => {
  try {
    const hero = await Hero.findById(req.params.id);

    if (!hero) {
      return res.status(404).json({
        success: false,
        message: "Hero not found",
      });
    }

    // Update hero
    const updatedHero = await Hero.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    clearHeroCache();

    res.status(200).json({
      success: true,
      message: "Hero updated successfully",
      data: updatedHero,
    });
  } catch (error) {

    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: Object.values(error.errors).map((err) => err.message),
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to update hero",
      error: error.message,
    });
  }
};

// @desc    Delete hero
// @route   DELETE /api/heroes/:id
// @access  Private/Admin
exports.deleteHero = async (req, res) => {
  try {
    const hero = await Hero.findById(req.params.id);

    if (!hero) {
      return res.status(404).json({
        success: false,
        message: "Hero not found",
      });
    }

    await hero.deleteOne();
    clearHeroCache();

    res.status(200).json({
      success: true,
      message: "Hero deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete hero",
      error: error.message,
    });
  }
};

// @desc    Toggle hero status
// @route   PATCH /api/heroes/:id/toggle
// @access  Private/Admin
exports.toggleHeroStatus = async (req, res) => {
  try {
    const hero = await Hero.findById(req.params.id);

    if (!hero) {
      return res.status(404).json({
        success: false,
        message: "Hero not found",
      });
    }

    hero.isActive = !hero.isActive;
    await hero.save();
    clearHeroCache();

    res.status(200).json({
      success: true,
      message: `Hero ${hero.isActive ? "activated" : "deactivated"
        } successfully`,
      data: hero,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to toggle hero status",
      error: error.message,
    });
  }
};

// @desc    Track hero click
// @route   POST /api/heroes/:id/click
// @access  Public
exports.trackHeroClick = async (req, res) => {
  try {
    const hero = await Hero.findById(req.params.id);

    if (!hero) {
      return res.status(404).json({
        success: false,
        message: "Hero not found",
      });
    }

    await hero.trackClick();

    res.status(200).json({
      success: true,
      message: "Click tracked successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to track click",
      error: error.message,
    });
  }
};

// @desc    Update hero priority
// @route   PATCH /api/heroes/:id/priority
// @access  Private/Admin
exports.updateHeroPriority = async (req, res) => {
  try {
    const { priority } = req.body;

    if (priority === undefined || priority < 0) {
      return res.status(400).json({
        success: false,
        message: "Valid priority is required",
      });
    }

    const hero = await Hero.findByIdAndUpdate(
      req.params.id,
      { priority },
      { new: true, runValidators: true }
    );

    if (!hero) {
      return res.status(404).json({
        success: false,
        message: "Hero not found",
      });
    }
    clearHeroCache();

    res.status(200).json({
      success: true,
      message: "Priority updated successfully",
      data: hero,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update priority",
      error: error.message,
    });
  }
};

// @desc    Get hero analytics
// @route   GET /api/heroes/:id/analytics
// @access  Private/Admin
exports.getHeroAnalytics = async (req, res) => {
  try {
    const hero = await Hero.findById(req.params.id);

    if (!hero) {
      return res.status(404).json({
        success: false,
        message: "Hero not found",
      });
    }

    const analytics = {
      impressions: hero.impressions,
      clicks: hero.clicks,
      ctr: hero.ctr,
    };

    res.status(200).json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch analytics",
      error: error.message,
    });
  }
};
