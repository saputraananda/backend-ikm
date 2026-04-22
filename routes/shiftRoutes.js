const express = require('express');
const router = express.Router();
const { getShiftsNormal, getShiftsValet } = require('../controllers/shiftController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.get('/normal', getShiftsNormal);
router.get('/valet', getShiftsValet);

module.exports = router;
