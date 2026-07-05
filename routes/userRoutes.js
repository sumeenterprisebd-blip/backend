const express = require("express");
const {
  getProfile,
  updateProfile,
  addAddress,
  updateAddress,
  deleteAddress,
  getAllUsers,
  updateUserRole,
  deleteUser,
  verifyUserEmail,
  blockUser,
  updateUserStatus,
  setUserSuspicious,
  verifyUserPhone,
  getUserOrders,
  getDuplicateUsers
} = require("../controllers/userController");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

// All user routes require authentication
router.use(protect);

router.get("/profile", getProfile);
router.put("/profile", updateProfile);
router.post("/addresses", addAddress);
router.put("/addresses/:addressId", updateAddress);
router.delete("/addresses/:addressId", deleteAddress);


// Admin/Moderator routes
router.get("/", authorize("admin", "moderator"), getAllUsers);
router.get("/duplicates", authorize("admin", "moderator"), getDuplicateUsers);
router.get("/:id/orders", authorize("admin", "moderator"), getUserOrders);
router.put("/:id/role", authorize("admin"), updateUserRole);
router.put("/:id/verify", authorize("admin"), verifyUserEmail);
router.put("/:id/verify-phone", authorize("admin"), verifyUserPhone);
router.put("/:id/block", authorize("admin"), blockUser);
router.put("/:id/status", authorize("admin"), updateUserStatus);
router.put("/:id/suspicious", authorize("admin", "moderator"), setUserSuspicious);
router.delete("/:id", authorize("admin"), deleteUser);

module.exports = router;
