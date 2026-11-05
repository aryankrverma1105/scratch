const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const backupController = require('../controllers/backupController');
const officeController = require('../controllers/officeController');
const attendanceReviewController = require('../controllers/attendanceReviewController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validateBody, createUserSchema } = require('../middleware/validate');

// All admin routes require valid JWT + admin role
router.use(authenticateToken, requireAdmin);

// Web & Mobile Dashboard KPIs and Reports
router.get('/dashboard/stats', adminController.getDashboardStats);
router.get('/dashboard/reports', adminController.getDashboardReports);

// User management (Requirement 4 & 5)
router.get('/users', adminController.listUsers);
router.get('/employees', adminController.listUsers);
router.post('/users', validateBody(createUserSchema), adminController.createUser);
router.get('/users/:id/profile', adminController.getUserProfile);
router.put('/users/:id', adminController.updateUser);
router.delete('/users/:id', adminController.deleteUser);

// Multi-Office Geofencing Management
router.get('/offices', officeController.listOffices);
router.post('/offices', officeController.createOffice);
router.get('/offices/:id', officeController.getOfficeById);
router.put('/offices/:id', officeController.updateOffice);
router.delete('/offices/:id', officeController.deleteOffice);

// Outside-Geofence Attendance Review Requests
router.get('/attendance-reviews/pending', attendanceReviewController.listPendingReviews);
router.post('/attendance-reviews/:id/approve', attendanceReviewController.approveReview);
router.post('/attendance-reviews/:id/reject', attendanceReviewController.rejectReview);
router.get('/attendance-reviews/history', attendanceReviewController.getReviewHistory);

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
router.post('/backups/records/:id/verify', backupController.verifyBackup);
router.post('/backups/records/:id/restore', backupController.restoreBackup);

module.exports = router;
