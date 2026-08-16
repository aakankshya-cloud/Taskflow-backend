const express = require('express');
const router = express.Router();
const { getMessages, sendMessage } = require('../controllers/messageController');
const auth = require('../middleware/auth');

router.get('/:workspaceId', auth, getMessages);
router.post('/:workspaceId', auth, sendMessage);

module.exports = router;