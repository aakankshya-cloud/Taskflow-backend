// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const { signup, login, forgotPassword, resetPassword } = require('../controllers/authController');
const validate = require('../middleware/validate');

router.post('/signup', validate('signup'), signup);
router.post('/login', validate('login'), login);
router.post('/forgot-password', validate('forgotPassword'), forgotPassword);
router.post('/reset-password', validate('resetPassword'), resetPassword);

module.exports = router;