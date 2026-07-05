const express = require("express");
const router = express.Router();
const {
  getMeasurements,
  getMeasurement,
  createMeasurement,
  updateMeasurement,
  deleteMeasurement,
} = require("../controllers/measurementController");
const { protect, admin } = require("../middleware/auth");

router.route("/").get(getMeasurements).post(protect, admin, createMeasurement);

router
  .route("/:id")
  .get(getMeasurement)
  .put(protect, admin, updateMeasurement)
  .delete(protect, admin, deleteMeasurement);

module.exports = router;
