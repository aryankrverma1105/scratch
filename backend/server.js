const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('./src/config');
const { initDatabase } = require('./src/db');

const authRoutes = require('./src/routes/authRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const attendanceRoutes = require('./src/routes/attendanceRoutes');
const locationRoutes = require('./src/routes/locationRoutes');
const fileRoutes = require('./src/routes/fileRoutes');

const app = express();

// Security and utility middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : '*';

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

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
app.use('/api/files', fileRoutes); // Authenticated selfies

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});

// Start server
async function start() {
  try {
    config.validateProductionSecurity();
    await initDatabase();
    
    // Initialize services
    const { initFcm } = require('./src/services/fcmService');
    const { startWatchdog } = require('./src/services/watchdog');
    const { initAutoCheckoutCron } = require('./src/services/autoCheckout');
    initFcm();
    startWatchdog();
    initAutoCheckoutCron();

    const bindHost = process.env.HOST || '0.0.0.0';
    const server = app.listen(config.PORT, bindHost, () => {
      console.log(`=======================================================`);
      console.log(`🚀 Sologix Energy Backend API running on port ${config.PORT} (${bindHost})`);
      console.log(`   Designed and developed by Aryan Kumar Verma`);
      console.log(`   Health check: http://${bindHost}:${config.PORT}/api/health`);
      console.log(`=======================================================`);
    });
    return server;
  } catch (err) {
    console.error('Failed to initialize server:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
