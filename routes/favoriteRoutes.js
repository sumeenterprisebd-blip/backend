const express = require('express');
const {
  getFavorites,
  addToFavorites,
  removeFromFavorites,
  checkFavorite
} = require('../controllers/favoriteController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// All favorite routes require authentication
router.use(protect);

router.get('/', getFavorites);
router.post('/', addToFavorites);
router.get('/check/:productId', checkFavorite);
router.delete('/:productId', removeFromFavorites);

module.exports = router;

