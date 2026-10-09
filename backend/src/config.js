const path = require('path');
require('dotenv').config();

function validateProductionSecurity() {
  if (process.env.NODE_ENV === 'production') {
    const secret = process.env.JWT_SECRET;
    const insecureDefaults = [
      'super_secret_attendance_jwt_key_2026',
      'secret',
      'default',
      'changeme',
      'admin123',
    ];
    if (!secret || insecureDefaults.includes(secret) || secret.length < 32) {
      throw new Error(
        'SECURITY VIOLATION: Server startup refused in production! JWT_SECRET must be explicitly provided, non-default, and at least 32 characters long.'
      );
    }
  }
}

module.exports = {
  PORT: process.env.PORT || 5050,
  JWT_SECRET: process.env.JWT_SECRET || 'super_secret_attendance_jwt_key_2026',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '12h', // Access token lifetime 12h
  DATABASE_URL: process.env.DATABASE_URL || '',
  SQLITE_PATH: process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'attendance.db'),
  UPLOAD_DIR: path.join(__dirname, '..', 'uploads'),
  SELFIE_DIR: path.join(__dirname, '..', 'uploads', 'selfies'),
  ADMIN_DEFAULT_EMAIL: process.env.ADMIN_DEFAULT_EMAIL || 'admin@company.com',
  ADMIN_DEFAULT_NAME: process.env.ADMIN_DEFAULT_NAME || 'System Administrator',
  COMPANY_TZ: process.env.COMPANY_TZ || 'Asia/Kolkata',
  AUTO_CHECKOUT_TIME: process.env.AUTO_CHECKOUT_TIME || '21:00',
  validateProductionSecurity,
};
