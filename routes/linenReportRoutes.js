const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { uploadLinenAttachment } = require('../middleware/upload');
const ctrl = require('../controllers/linenReportController');

router.get('/areas',     authMiddleware, ctrl.getAreas);
router.get('/hospitals', authMiddleware, ctrl.getHospitals);
router.post('/', authMiddleware, uploadLinenAttachment.single('attachment'), ctrl.submitLinenReport);

module.exports = router;
