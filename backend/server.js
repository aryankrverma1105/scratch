const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const config = require('./src/config');
const { initDatabase } = require('./src/db');

const authRoutes = require('./src/routes/authRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const attendanceRoutes = require('./src/routes/attendanceRoutes');
const locationRoutes = require('./src/routes/locationRoutes');

const app = express();

// Security and utility middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

// Static uploads directory (selfies)
app.use('/uploads', express.static(config.UPLOAD_DIR));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Sologix Energy Attendance & Location API',
    company: 'Sologix Energy - Energizing Naturally',
    developed_by: 'Aryan Kumar Verma',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/location', locationRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});

// Start server
async function start() {
  try {
    await initDatabase();
    app.listen(config.PORT, '0.0.0.0', () => {
      console.log(`=======================================================`);
      console.log(`🚀 Sologix Energy Backend API running on port ${config.PORT}`);
      console.log(`   Designed and developed by Aryan Kumar Verma`);
      console.log(`   Health check: http://localhost:${config.PORT}/api/health`);
      console.log(`   Default Admin: ${config.ADMIN_DEFAULT_EMAIL} / ${config.ADMIN_DEFAULT_PASSWORD}`);
      console.log(`=======================================================`);
    });
  } catch (err) {
    console.error('Failed to initialize server:', err);
    process.exit(1);
  }
}

start();
