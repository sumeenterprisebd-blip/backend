const express = require("express");
const { validate } = require("../middleware/validator");
const {
    sitemapValidators,
    getSitemapProducts,
    getSitemapCategories,
} = require("../controllers/seoController");

const router = express.Router();

router.get("/sitemap/products", sitemapValidators, validate, getSitemapProducts);
router.get("/sitemap/categories", sitemapValidators, validate, getSitemapCategories);

module.exports = router;
