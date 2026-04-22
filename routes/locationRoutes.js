const express        = require('express');
const router         = express.Router();
const { getLocations } = require('../controllers/locationController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.get('/', getLocations);

module.exports = router;
