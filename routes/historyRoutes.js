const express        = require('express');
const router         = express.Router();
const ctrl           = require('../controllers/historyController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.get('/combined', ctrl.combinedHistory);

module.exports = router;
