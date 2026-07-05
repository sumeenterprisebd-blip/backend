const Campaign = require("../models/Campaign");
const cloudinary = require("../utils/cloudinary");

// @desc    Get all campaigns (Admin)
// @route   GET /api/campaigns
// @access  Private/Admin
exports.getCampaigns = async (req, res, next) => {
  try {
    const { status, active } = req.query;

    const query = {};

    if (status) {
      query.isActive = status === "active";
    }

    if (active === "true") {
      const now = new Date();
      query.isActive = true;
      query.startDate = { $lte: now };
      query.endDate = { $gte: now };
    }

    const campaigns = await Campaign.find(query).sort({
      priority: -1,
      createdAt: -1,
    });

    res.status(200).json({
      success: true,
      count: campaigns.length,
      data: campaigns,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get active campaign for frontend
// @route   GET /api/campaigns/active
// @access  Public
exports.getActiveCampaign = async (req, res, next) => {
  try {
    const campaign = await Campaign.getActiveCampaign();

    if (!campaign) {
      return res.status(200).json({
        success: true,
        data: null,
      });
    }

    // Increment impressions
    campaign.impressions += 1;
    await campaign.save();

    res.status(200).json({
      success: true,
      data: campaign,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single campaign
// @route   GET /api/campaigns/:id
// @access  Private/Admin
exports.getCampaign = async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    res.status(200).json({
      success: true,
      data: campaign,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new campaign
// @route   POST /api/campaigns
// @access  Private/Admin
exports.createCampaign = async (req, res, next) => {
  try {
    const {
      title,
      subtitle,
      description,
      discountText,
      bannerImage,
      mobileBannerImage,
      ctaButtonText,
      ctaButtonLink,
      startDate,
      endDate,
      isActive,
      backgroundColor,
      textColor,
      priority,
    } = req.body;

    // Validate dates
    if (new Date(startDate) >= new Date(endDate)) {
      return res.status(400).json({
        success: false,
        message: "End date must be after start date",
      });
    }

    // Check for overlapping active campaigns
    if (isActive) {
      const now = new Date();
      const overlapping = await Campaign.findOne({
        isActive: true,
        $or: [
          {
            startDate: { $lte: new Date(endDate) },
            endDate: { $gte: new Date(startDate) },
          },
        ],
      });

      if (overlapping) {
        return res.status(400).json({
          success: false,
          message: "An active campaign already exists for this time period",
        });
      }
    }

    const campaign = await Campaign.create({
      title,
      subtitle,
      description,
      discountText,
      bannerImage,
      mobileBannerImage,
      ctaButtonText,
      ctaButtonLink,
      startDate,
      endDate,
      isActive,
      backgroundColor,
      textColor,
      priority,
    });

    res.status(201).json({
      success: true,
      data: campaign,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update campaign
// @route   PUT /api/campaigns/:id
// @access  Private/Admin
exports.updateCampaign = async (req, res, next) => {
  try {
    let campaign = await Campaign.findById(req.params.id);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    const {
      title,
      subtitle,
      description,
      discountText,
      bannerImage,
      mobileBannerImage,
      ctaButtonText,
      ctaButtonLink,
      startDate,
      endDate,
      isActive,
      backgroundColor,
      textColor,
      priority,
    } = req.body;

    // Validate dates
    if (startDate && endDate && new Date(startDate) >= new Date(endDate)) {
      return res.status(400).json({
        success: false,
        message: "End date must be after start date",
      });
    }

    // Check for overlapping active campaigns (excluding current one)
    if (isActive) {
      const overlapping = await Campaign.findOne({
        _id: { $ne: req.params.id },
        isActive: true,
        $or: [
          {
            startDate: { $lte: new Date(endDate || campaign.endDate) },
            endDate: { $gte: new Date(startDate || campaign.startDate) },
          },
        ],
      });

      if (overlapping) {
        return res.status(400).json({
          success: false,
          message: "An active campaign already exists for this time period",
        });
      }
    }

    campaign = await Campaign.findByIdAndUpdate(
      req.params.id,
      {
        title,
        subtitle,
        description,
        discountText,
        bannerImage,
        mobileBannerImage,
        ctaButtonText,
        ctaButtonLink,
        startDate,
        endDate,
        isActive,
        backgroundColor,
        textColor,
        priority,
      },
      {
        new: true,
        runValidators: true,
      }
    );

    res.status(200).json({
      success: true,
      data: campaign,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete campaign
// @route   DELETE /api/campaigns/:id
// @access  Private/Admin
exports.deleteCampaign = async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    await campaign.deleteOne();

    res.status(200).json({
      success: true,
      message: "Campaign deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle campaign status
// @route   PATCH /api/campaigns/:id/toggle
// @access  Private/Admin
exports.toggleCampaignStatus = async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    campaign.isActive = !campaign.isActive;

    // If activating, check for overlaps
    if (campaign.isActive) {
      const overlapping = await Campaign.findOne({
        _id: { $ne: req.params.id },
        isActive: true,
        $or: [
          {
            startDate: { $lte: campaign.endDate },
            endDate: { $gte: campaign.startDate },
          },
        ],
      });

      if (overlapping) {
        return res.status(400).json({
          success: false,
          message:
            "Cannot activate: Another campaign is already active for this period",
        });
      }
    }

    await campaign.save();

    res.status(200).json({
      success: true,
      data: campaign,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Track campaign click
// @route   POST /api/campaigns/:id/click
// @access  Public
exports.trackCampaignClick = async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    campaign.clicks += 1;
    await campaign.save();

    res.status(200).json({
      success: true,
      message: "Click tracked",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get campaign analytics
// @route   GET /api/campaigns/:id/analytics
// @access  Private/Admin
exports.getCampaignAnalytics = async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    const clickThroughRate =
      campaign.impressions > 0
        ? ((campaign.clicks / campaign.impressions) * 100).toFixed(2)
        : 0;

    res.status(200).json({
      success: true,
      data: {
        impressions: campaign.impressions,
        clicks: campaign.clicks,
        clickThroughRate: `${clickThroughRate}%`,
      },
    });
  } catch (error) {
    next(error);
  }
};
