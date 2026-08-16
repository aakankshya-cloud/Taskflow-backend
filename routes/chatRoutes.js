const express = require('express');
const router = express.Router();
const { chat } = require('../controllers/chatController');
const auth = require('../middleware/auth'); // ⚠️ confirm this matches your actual auth middleware filename/export

router.post('/', auth, chat);

module.exports = router;