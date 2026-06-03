const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { uploadLinenAttachment } = require('../middleware/upload');
const ctrl = require('../controllers/linenReportController');

/* Master data */
router.get('/areas',       authMiddleware, ctrl.getAreas);
router.get('/hospitals',   authMiddleware, ctrl.getHospitals);
router.get('/leaders',     authMiddleware, ctrl.getLeaders);
router.get('/employees',   authMiddleware, ctrl.getEmployees);

/* Today check */
router.get('/check-today', authMiddleware, ctrl.checkTodayReport);

/* Reports – own + all */
router.get('/my-reports',   authMiddleware, ctrl.getMyReports);
router.get('/all-reports',  authMiddleware, ctrl.getAllReports);

/* Single report CRUD */
router.get('/:id',         authMiddleware, ctrl.getReportById);
router.put('/:id',         authMiddleware, uploadLinenAttachment.single('attachment'), ctrl.updateReport);
router.delete('/:id',      authMiddleware, ctrl.deleteReport);

/* Status / progress workflow */
router.patch('/:id/status', authMiddleware, uploadLinenAttachment.single('attachment'), ctrl.updateStatus);

/* Submit new report */
router.post('/', authMiddleware, uploadLinenAttachment.single('attachment'), ctrl.submitLinenReport);

module.exports = router;
