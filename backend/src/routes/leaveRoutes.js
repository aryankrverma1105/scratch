const express = require('express');
const router = express.Router();
const leaveController = require('../controllers/leaveController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// All leave routes require authenticated JWT
router.use(authenticateToken);

// --- EMPLOYEE & GENERAL LEAVE ROUTES ---
router.get('/balance', leaveController.getMyLeaveBalance);
router.get('/summary', leaveController.getMyLeaveSummary);
router.get('/history', leaveController.getMyLeaveHistory);
router.post('/calculate', leaveController.calculateLeave);
router.post('/request', leaveController.requestLeave);
router.post('/:id/cancel', leaveController.cancelLeave);
router.get('/holidays', leaveController.getHolidays);

// --- ADMIN PROTECTED ROUTES ---
router.get('/admin/summaries', requireAdmin, leaveController.adminGetSummaries);
router.get('/admin/records', requireAdmin, leaveController.adminGetRecords);
router.get('/admin/absences', requireAdmin, leaveController.adminGetAbsences);
router.post('/admin/absences/:id/correct', requireAdmin, leaveController.adminCorrectAbsence);
router.post('/admin/holidays', requireAdmin, leaveController.adminCreateHoliday);
router.put('/admin/holidays/:id', requireAdmin, leaveController.adminUpdateHoliday);
router.delete('/admin/holidays/:id', requireAdmin, leaveController.adminDeleteHoliday);
router.post('/admin/reconcile', requireAdmin, leaveController.adminTriggerReconciliation);
router.post('/admin/accrue', requireAdmin, leaveController.adminTriggerAccrual);

module.exports = router;
