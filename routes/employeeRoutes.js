const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/employeeController');
const authMiddleware = require('../middleware/authMiddleware');
const { uploadEmployeeDoc } = require('../middleware/upload');

router.use(authMiddleware);

router.get('/banks',                ctrl.getBanks);
router.get('/profile-detail',       ctrl.getProfileDetail);
router.put('/update-profile',       ctrl.updateProfile);
router.post('/upload-doc/:docType', uploadEmployeeDoc.single('doc'), ctrl.uploadDoc);

module.exports = router;
