const express        = require('express');
const router         = express.Router();
const ctrl           = require('../controllers/managementAttendanceController');
const authMiddleware = require('../middleware/authMiddleware');
const { uploadSelfie } = require('../middleware/upload');

router.use(authMiddleware);

router.get('/today',        ctrl.getTodayAttendance);
router.post('/punch-selfie', uploadSelfie.single('selfie'), ctrl.punchSelfie);
router.post('/delete-punch', ctrl.deletePunch);

module.exports = router;
