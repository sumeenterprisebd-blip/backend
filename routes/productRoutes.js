const express = require("express");
const { body } = require("express-validator");
const {
  getProducts,
  getAdminProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getCategories,
} = require("../controllers/productController");
const { protect, authorize } = require("../middleware/auth");
const { validate } = require("../middleware/validator");

const router = express.Router();

const productValidation = [
  body("name").trim().notEmpty().withMessage("Product name is required"),
  body("price")
    .isFloat({ min: 0 })
    .withMessage("Price must be a positive number"),
  body("category").trim().notEmpty().withMessage("Category is required"),
  body("images")
    .isArray({ min: 1 })
    .withMessage("At least one image is required"),
  body("stock")
    .isInt({ min: 0 })
    .withMessage("Stock must be a non-negative integer"),
];

// Public routes
router.get("/", getProducts);
router.get("/categories", getCategories);
router.get("/admin/all", protect, authorize("admin"), getAdminProducts);
router.get("/:id", getProduct);

// Protected/Admin routes
router.post(
  "/",
  protect,
  authorize("admin"),
  productValidation,
  validate,
  createProduct
);
router.put(
  "/:id",
  protect,
  authorize("admin"),
  productValidation,
  validate,
  updateProduct
);
router.delete("/:id", protect, authorize("admin"), deleteProduct);

module.exports = router;
