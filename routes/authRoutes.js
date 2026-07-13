// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const { signup, login } = require('../controllers/authController');
const validate = require('../middleware/validate');

router.post('/signup', validate('signup'), signup);
router.post('/login', validate('login'), login);

module.exports = router;