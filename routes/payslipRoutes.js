const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const ctrl = require('../controllers/payslipController');

router.get('/',       authMiddleware, ctrl.getPayslips);
router.get('/months', authMiddleware, ctrl.getPayslipMonths);

module.exports = router;
