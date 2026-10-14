const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const salaryController = require('../controllers/salaryController');
const auditLogController = require('../controllers/auditLogController');

// All salary routes require authentication
router.use(authenticateToken);

// Employee routes (accessible to both employees and admins for their own records)
router.get('/my-salary', salaryController.getMySalary);
router.get('/my-incentives', salaryController.getMyIncentives);
router.get('/my-overtime', salaryController.getMyOvertime);
router.get('/my-history', salaryController.getMyPayrollHistory);

// Admin-only routes
router.get('/admin/settings', requireRole('admin'), salaryController.getSettings);
router.put('/admin/settings', requireRole('admin'), salaryController.updateSettings);

router.get('/admin/configs', requireRole('admin'), salaryController.listEmployeeConfigs);
router.get('/admin/configs/:userId', requireRole('admin'), salaryController.getEmployeeConfig);
router.post('/admin/configs', requireRole('admin'), salaryController.saveEmployeeConfig);

router.get('/admin/incentives', requireRole('admin'), salaryController.listIncentives);
router.post('/admin/incentives', requireRole('admin'), salaryController.createIncentive);
router.put('/admin/incentives/:id', requireRole('admin'), salaryController.updateIncentive);
router.delete('/admin/incentives/:id', requireRole('admin'), salaryController.deleteIncentive);

router.get('/admin/overtime', requireRole('admin'), salaryController.listOvertime);
router.post('/admin/overtime', requireRole('admin'), salaryController.createOvertime);
router.put('/admin/overtime/:id', requireRole('admin'), salaryController.updateOvertime);
router.delete('/admin/overtime/:id', requireRole('admin'), salaryController.deleteOvertime);

router.get('/admin/payroll/preview', requireRole('admin'), salaryController.previewPayroll);
router.post('/admin/payroll/finalize', requireRole('admin'), salaryController.finalizePayroll);
router.get('/admin/payroll/export', requireRole('admin'), salaryController.exportPayrollCsv);
router.get('/admin/payroll/records', requireRole('admin'), salaryController.getPayrollRecords);

module.exports = router;
