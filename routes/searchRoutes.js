const express = require("express");
const { validate } = require("../middleware/validator");
const { searchLimiter } = require("../middleware/rateLimiters");
const {
    searchProducts,
    suggestProducts,
    searchValidators,
    suggestValidators,
} = require("../controllers/searchController");

const router = express.Router();

router.get("/", searchLimiter, searchValidators, validate, searchProducts);
router.get("/suggest", searchLimiter, suggestValidators, validate, suggestProducts);

module.exports = router;
