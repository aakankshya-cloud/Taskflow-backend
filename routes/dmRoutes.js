const express = require('express');
const router = express.Router();
const {
  listConversations,
  startConversation,
  getMessages,
  sendMessage,
} = require('../controllers/dmController');
const auth = require('../middleware/auth');

router.get('/:workspaceId/conversations', auth, listConversations);
router.post('/:workspaceId/conversations', auth, startConversation);
router.get('/conversations/:conversationId/messages', auth, getMessages);
router.post('/conversations/:conversationId/messages', auth, sendMessage);

module.exports = router;