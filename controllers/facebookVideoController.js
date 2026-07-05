// Removed Facebook video controller

// const FacebookVideo = require("../models/FacebookVideo");
// exports.getFacebookVideos = async (req, res) => {...};
// exports.getActiveFacebookVideos = async (req, res) => {...};
// exports.getFacebookVideo = async (req, res) => {...};
// exports.createFacebookVideo = async (req, res) => {...};
// exports.updateFacebookVideo = async (req, res) => {...};
// exports.deleteFacebookVideo = async (req, res) => {...};
// exports.toggleFacebookVideoStatus = async (req, res) => {...};
// exports.trackFacebookVideoClick = async (req, res) => {...};
// exports.getFacebookVideoAnalytics = async (req, res) => {...};
const FacebookVideo = require("../models/FacebookVideo");

// @desc    Get all Facebook videos (admin)
// @route   GET /api/facebook-videos
// @access  Private/Admin
exports.getFacebookVideos = async (req, res) => {
  try {
    const { status, active } = req.query;

    let query = {};

    if (status) {
      query.isActive = status === "active";
    }

    if (active !== undefined) {
      query.isActive = active === "true";
    }

    const videos = await FacebookVideo.find(query)
      .sort({ priority: -1, createdAt: -1 })
      .select("-__v");

    res.status(200).json({
      success: true,
      count: videos.length,
      data: videos,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch Facebook videos",
      error: error.message,
    });
  }
};

// @desc    Get active Facebook videos (public)
// @route   GET /api/facebook-videos/active
// @access  Public
exports.getActiveFacebookVideos = async (req, res) => {
  try {
    const videos = await FacebookVideo.getActiveVideos();

    // Track impressions for all active videos
    if (videos.length > 0) {
      await Promise.all(videos.map((video) => video.trackImpression()));
    }

    res.status(200).json({
      success: true,
      count: videos.length,
      data: videos,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch active Facebook videos",
      error: error.message,
    });
  }
};

// @desc    Get single Facebook video
// @route   GET /api/facebook-videos/:id
// @access  Private/Admin
exports.getFacebookVideo = async (req, res) => {
  try {
    const video = await FacebookVideo.findById(req.params.id);

    if (!video) {
      return res.status(404).json({
        success: false,
        message: "Facebook video not found",
      });
    }

    res.status(200).json({
      success: true,
      data: video,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch Facebook video",
      error: error.message,
    });
  }
};

// @desc    Create new Facebook video
// @route   POST /api/facebook-videos
// @access  Private/Admin
exports.createFacebookVideo = async (req, res) => {
  try {
    const videoData = req.body;

    // Create video
    const video = await FacebookVideo.create(videoData);

    res.status(201).json({
      success: true,
      message: "Facebook video created successfully",
      data: video,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to create Facebook video",
      error: error.message,
    });
  }
};

// @desc    Update Facebook video
// @route   PUT /api/facebook-videos/:id
// @access  Private/Admin
exports.updateFacebookVideo = async (req, res) => {
  try {
    const video = await FacebookVideo.findById(req.params.id);

    if (!video) {
      return res.status(404).json({
        success: false,
        message: "Facebook video not found",
      });
    }

    // Update video
    const updatedVideo = await FacebookVideo.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    );

    res.status(200).json({
      success: true,
      message: "Facebook video updated successfully",
      data: updatedVideo,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update Facebook video",
      error: error.message,
    });
  }
};

// @desc    Delete Facebook video
// @route   DELETE /api/facebook-videos/:id
// @access  Private/Admin
exports.deleteFacebookVideo = async (req, res) => {
  try {
    const video = await FacebookVideo.findById(req.params.id);

    if (!video) {
      return res.status(404).json({
        success: false,
        message: "Facebook video not found",
      });
    }

    await video.deleteOne();

    res.status(200).json({
      success: true,
      message: "Facebook video deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete Facebook video",
      error: error.message,
    });
  }
};

// @desc    Toggle Facebook video active status
// @route   PATCH /api/facebook-videos/:id/toggle
// @access  Private/Admin
exports.toggleFacebookVideoStatus = async (req, res) => {
  try {
    const video = await FacebookVideo.findById(req.params.id);

    if (!video) {
      return res.status(404).json({
        success: false,
        message: "Facebook video not found",
      });
    }

    video.isActive = !video.isActive;
    await video.save();

    res.status(200).json({
      success: true,
      message: `Facebook video ${video.isActive ? "activated" : "deactivated"
        } successfully`,
      data: video,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to toggle Facebook video status",
      error: error.message,
    });
  }
};

// @desc    Track Facebook video click
// @route   POST /api/facebook-videos/:id/click
// @access  Public
exports.trackFacebookVideoClick = async (req, res) => {
  try {
    const video = await FacebookVideo.findById(req.params.id);

    if (!video) {
      return res.status(404).json({
        success: false,
        message: "Facebook video not found",
      });
    }

    await video.trackClick();

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

// @desc    Get Facebook video analytics
// @route   GET /api/facebook-videos/analytics
// @access  Private/Admin
exports.getFacebookVideoAnalytics = async (req, res) => {
  try {
    const videos = await FacebookVideo.find().select(
      "title analytics isActive createdAt"
    );

    const analytics = {
      totalVideos: videos.length,
      activeVideos: videos.filter((v) => v.isActive).length,
      inactiveVideos: videos.filter((v) => !v.isActive).length,
      totalImpressions: videos.reduce(
        (sum, v) => sum + v.analytics.impressions,
        0
      ),
      totalClicks: videos.reduce((sum, v) => sum + v.analytics.clicks, 0),
      videos: videos.map((v) => ({
        id: v._id,
        title: v.title,
        isActive: v.isActive,
        impressions: v.analytics.impressions,
        clicks: v.analytics.clicks,
        ctr: v.ctr,
        lastViewed: v.analytics.lastViewed,
        createdAt: v.createdAt,
      })),
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
