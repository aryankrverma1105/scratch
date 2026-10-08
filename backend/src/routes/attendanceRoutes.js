const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');
const { authenticateToken } = require('../middleware/auth');
const { upload, compressSelfie } = require('../middleware/upload');

router.use(authenticateToken);

router.get('/current', attendanceController.getCurrentStatus);
router.post('/check-in', upload.single('selfie'), compressSelfie, attendanceController.checkIn);
router.post('/check-out', upload.single('selfie'), compressSelfie, attendanceController.checkOut);
router.get('/my-history', attendanceController.getMyHistory);

module.exports = router;
