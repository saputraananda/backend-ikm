const express        = require('express');
const router         = express.Router();
const ctrl           = require('../controllers/attendanceController');
const authMiddleware = require('../middleware/authMiddleware');
const { uploadSelfie } = require('../middleware/upload');

router.use(authMiddleware);

router.get('/today-shifts',  ctrl.getTodayShifts);
router.post('/shift-punch',  ctrl.shiftPunch);
router.post('/shift-punch-selfie', uploadSelfie.single('selfie'), ctrl.shiftPunchSelfie);
router.get('/history',       ctrl.history);

module.exports = router;