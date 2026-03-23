const express        = require('express');
const router         = express.Router();
const ctrl           = require('../controllers/attendanceController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.get('/today-shifts',  ctrl.getTodayShifts);
router.post('/shift-punch',  ctrl.shiftPunch);
router.get('/history',       ctrl.history);

module.exports = router;