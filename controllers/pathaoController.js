const pathaoService = require("../utils/pathao");

// @desc    Get Pathao integration status (no secrets)
// @route   GET /api/pathao/status
// @access  Public
exports.getPathaoStatus = async (req, res) => {
    return res.status(200).json({
        success: true,
        authConfigured: pathaoService.isAuthConfigured(),
        configured: pathaoService.isConfigured(),
        baseURL: pathaoService.getBaseURL(),
    });
};

// @desc    Test Pathao auth (verifies API URL + credentials, returns no token)
// @route   POST /api/pathao/auth-test
// @access  Private/Admin
exports.testPathaoAuth = async (req, res, next) => {
    try {
        if (!pathaoService.isConfigured()) {
            return res.status(400).json({
                success: false,
                message:
                    "Pathao is not configured. Set PATHAO_CLIENT_ID, PATHAO_CLIENT_SECRET, PATHAO_USERNAME, PATHAO_PASSWORD, PATHAO_STORE_ID.",
            });
        }

        await pathaoService.getAccessToken();

        return res.status(200).json({
            success: true,
            message: "Pathao authentication OK",
            baseURL: pathaoService.getBaseURL(),
        });
    } catch (error) {
        next(error);
    }
};
