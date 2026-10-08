const express = require('express');
const router = express.Router();
const locationController = require('../controllers/locationController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

router.post('/track', locationController.recordLocation);
router.post('/gps-status', locationController.reportGpsStatus);

module.exports = router;
