const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');

dotenv.config();

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    // Check if admin already exists

    // CHANGE THESE VALUES AS NEEDED
    const newAdminEmail = 'support@sumetraders.com'; // <-- Set new admin email here
    const newAdminPassword = 'sabbiR1257@'; // <-- Set new admin password here

    const existingAdmin = await User.findOne({ email: newAdminEmail });
    if (existingAdmin) {
      process.exit(0);
    }

    // Create admin user
    const admin = await User.create({
      firstName: 'Admin',
      lastName: 'User',
      email: newAdminEmail,
      password: newAdminPassword, // Change this in production!
      role: 'admin',
      isEmailVerified: true
    });

    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
};

seedAdmin();

