const path = require('path');
require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 5000,
  JWT_SECRET: process.env.JWT_SECRET || 'super_secret_attendance_jwt_key_2026',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '30d',
  DATABASE_URL: process.env.DATABASE_URL || '', // If empty, uses SQLite
  SQLITE_PATH: process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'attendance.db'),
  UPLOAD_DIR: path.join(__dirname, '..', 'uploads'),
  SELFIE_DIR: path.join(__dirname, '..', 'uploads', 'selfies'),
  ADMIN_DEFAULT_EMAIL: process.env.ADMIN_DEFAULT_EMAIL || 'admin@company.com',
  ADMIN_DEFAULT_PASSWORD: process.env.ADMIN_DEFAULT_PASSWORD || 'admin123',
  ADMIN_DEFAULT_NAME: process.env.ADMIN_DEFAULT_NAME || 'System Administrator',
};
