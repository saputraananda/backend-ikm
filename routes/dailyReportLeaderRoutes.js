const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { uploadDailyReportBriefing } = require('../middleware/upload');
const ctrl = require('../controllers/dailyReportLeaderController');

router.get('/areas',       authMiddleware, ctrl.getAreas);
router.get('/employees',   authMiddleware, ctrl.getEmployees);
router.get('/check-today', authMiddleware, ctrl.checkTodayReport);
router.get('/my-reports',  authMiddleware, ctrl.getMyReports);
router.get('/:id',         authMiddleware, ctrl.getReport);
router.post('/',           authMiddleware, uploadDailyReportBriefing.single('briefing_doc'), ctrl.submitDailyReport);
router.put('/:id',         authMiddleware, uploadDailyReportBriefing.single('briefing_doc'), ctrl.updateDailyReport);
router.delete('/:id',      authMiddleware, ctrl.deleteReport);

module.exports = router;
