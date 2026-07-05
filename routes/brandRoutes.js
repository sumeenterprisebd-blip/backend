const express = require('express');
const router = express.Router();
const {
  getBrands,
  getAllBrands,
  getBrandById,
  createBrand,
  updateBrand,
  deleteBrand,
  getPressReleases
} = require('../controllers/brandController');
const { protect, authorize } = require('../middleware/auth');

// Public routes
router.get('/public', getBrands); // Get active brands for frontend
router.get('/press-releases', getPressReleases); // Get published press releases

// Admin routes (protected)
router.get('/', protect, authorize('admin'), getAllBrands); // Get all brands (admin)
router.get('/:id', protect, authorize('admin'), getBrandById); // Get single brand
router.post('/', protect, authorize('admin'), createBrand); // Create brand
router.put('/:id', protect, authorize('admin'), updateBrand); // Update brand
router.delete('/:id', protect, authorize('admin'), deleteBrand); // Delete brand

module.exports = router;

