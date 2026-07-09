const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const ctrl = require('../controllers/rewashController');

/* Master/helper endpoints */
router.get('/hospitals',   authMiddleware, ctrl.getHospitals);
router.get('/employees',   authMiddleware, ctrl.getEmployees);
router.get('/linens',      authMiddleware, ctrl.getLinens);

/* Reports list */
router.get('/my-reports',  authMiddleware, ctrl.getMyReports);
router.get('/all-reports', authMiddleware, ctrl.getAllReports);

/* CRUD — header+detail via single ID-based endpoints */
router.post('/',           authMiddleware, ctrl.submitRewash);
router.put('/:id',         authMiddleware, ctrl.updateReport);
router.delete('/:id',      authMiddleware, ctrl.deleteReport);

module.exports = router;
