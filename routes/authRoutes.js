const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/login', authController.login);
router.get('/profile', authMiddleware, authController.profile);
router.get('/leader-role', authMiddleware, authController.leaderRole);
router.post('/register', authMiddleware, authController.register);
router.put('/reset-password', authMiddleware, authController.resetPassword);

module.exports = router;