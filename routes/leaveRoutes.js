const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/leaveController');
const authMiddleware = require('../middleware/authMiddleware');
const { uploadDoctorNote } = require('../middleware/upload');

router.use(authMiddleware);

router.get('/today',    ctrl.getTodayLeave);
router.get('/years',    ctrl.getLeaveYears);
router.get('/stats',    ctrl.getLeaveStats);
router.get('/list',     ctrl.getLeaveList);
router.post('/',        uploadDoctorNote.single('doctor_note'), ctrl.submitLeave);
router.put('/:id',      uploadDoctorNote.single('doctor_note'), ctrl.updateLeave);
router.delete('/:id',   ctrl.cancelLeave);

module.exports = router;
