const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const backupController = require('../controllers/backupController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validateBody, createUserSchema } = require('../middleware/validate');

// All admin routes require valid JWT + admin role
router.use(authenticateToken, requireAdmin);

// User management (Requirement 4 & 5)
router.get('/users', adminController.listUsers);
router.post('/users', validateBody(createUserSchema), adminController.createUser);
router.get('/users/:id/profile', adminController.getUserProfile);
router.put('/users/:id', adminController.updateUser);
router.delete('/users/:id', adminController.deleteUser);

// Live location map tracking (Requirement 12)
router.get('/live-locations', adminController.getLiveLocations);

// Route history / polyline paths (Requirement 13)
router.get('/users/:id/route', adminController.getUserRouteHistory);

// Attendance records
router.get('/attendance', adminController.getAllAttendance);

// GPS status alerts (Requirement 14 & 15)
router.get('/alerts', adminController.getGpsAlerts);
router.post('/alerts/:id/resolve', adminController.resolveGpsAlert);

// Automated & Manual Backups to Google Drive
router.get('/backups/destinations', backupController.listDestinations);
router.post('/backups/destinations', backupController.saveDestination);
router.post('/backups/destinations/:id/test', backupController.testDestination);
router.delete('/backups/destinations/:id', backupController.deleteDestination);
router.get('/backups/history', backupController.getBackupHistory);
router.post('/backups/trigger', backupController.triggerBackup);
router.post('/backups/records/:id/retry', backupController.retryBackup);

module.exports = router;
