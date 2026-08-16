const db = require('../config/db');
const { getMembership } = require('../middleware/authorize');

// Always store the smaller id as user_one_id so "A messages B" and
// "B messages A" resolve to the same conversation row.
function orderedPair(a, b) {
  return Number(a) < Number(b) ? [a, b] : [b, a];
}

async function findOrCreateConversation(workspaceId, userId, otherUserId) {
  const [userOne, userTwo] = orderedPair(userId, otherUserId);

  const [existing] = await db.query(
    'SELECT id FROM conversations WHERE workspace_id = ? AND user_one_id = ? AND user_two_id = ?',
    [workspaceId, userOne, userTwo]
  );
  if (existing.length > 0) return existing[0].id;

  const [result] = await db.query(
    'INSERT INTO conversations (workspace_id, user_one_id, user_two_id) VALUES (?, ?, ?)',
    [workspaceId, userOne, userTwo]
  );
  return result.insertId;
}

// GET /api/dms/:workspaceId/conversations
// List all of the caller's conversations in this workspace, with the
// other participant's name and the most recent message as a preview.
exports.listConversations = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const role = await getMembership(workspaceId, req.user.id);
    if (!role) return res.status(403).json({ message: 'You are not a member of this workspace' });

    const [rows] = await db.query(
      `SELECT c.id as conversation_id,
              CASE WHEN c.user_one_id = ? THEN c.user_two_id ELSE c.user_one_id END as other_user_id,
              u.name as other_user_name,
              (SELECT content FROM direct_messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) as last_message,
              (SELECT created_at FROM direct_messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) as last_message_at,
              (SELECT COUNT(*) FROM direct_messages WHERE conversation_id = c.id AND sender_id != ? AND read_at IS NULL) as unread_count
       FROM conversations c
       JOIN users u ON u.id = CASE WHEN c.user_one_id = ? THEN c.user_two_id ELSE c.user_one_id END
       WHERE c.workspace_id = ? AND (c.user_one_id = ? OR c.user_two_id = ?)
       ORDER BY last_message_at IS NULL, last_message_at DESC`,
      [req.user.id, req.user.id, req.user.id, workspaceId, req.user.id, req.user.id]
    );

    res.json({ conversations: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/dms/:workspaceId/conversations
// Body: { otherUserId } — finds or creates the conversation and returns its id.
// This is what the "Message" button in the Members modal calls.
exports.startConversation = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { otherUserId } = req.body;

    if (!otherUserId) return res.status(400).json({ message: 'otherUserId is required' });
    if (Number(otherUserId) === req.user.id) {
      return res.status(400).json({ message: "You can't message yourself" });
    }

    const role = await getMembership(workspaceId, req.user.id);
    if (!role) return res.status(403).json({ message: 'You are not a member of this workspace' });

    const otherRole = await getMembership(workspaceId, otherUserId);
    if (!otherRole) return res.status(400).json({ message: 'That user is not a member of this workspace' });

    const conversationId = await findOrCreateConversation(workspaceId, req.user.id, otherUserId);
    res.json({ conversationId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/dms/conversations/:conversationId/messages
exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;

    const [convo] = await db.query('SELECT * FROM conversations WHERE id = ?', [conversationId]);
    if (convo.length === 0) return res.status(404).json({ message: 'Conversation not found' });

    // Must be one of the two participants — this is the DM equivalent of
    // the workspace-membership check used everywhere else.
    const { user_one_id, user_two_id } = convo[0];
    if (req.user.id !== user_one_id && req.user.id !== user_two_id) {
      return res.status(403).json({ message: 'Not part of this conversation' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before;

    const params = [conversationId];
    let whereClause = 'conversation_id = ?';
    if (before) {
      whereClause += ' AND id < ?';
      params.push(before);
    }

    const [messages] = await db.query(
      `SELECT id, content, created_at, sender_id, read_at
       FROM direct_messages
       WHERE ${whereClause}
       ORDER BY id DESC
       LIMIT ?`,
      [...params, limit]
    );

    // Mark the other person's messages as read now that this user has
    // fetched the thread.
    await db.query(
      'UPDATE direct_messages SET read_at = NOW() WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL',
      [conversationId, req.user.id]
    );

    res.json({ messages: messages.reverse() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/dms/conversations/:conversationId/messages
exports.sendMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'Message content is required' });
    }
    if (content.length > 2000) {
      return res.status(400).json({ message: 'Message is too long' });
    }

    const [convo] = await db.query('SELECT * FROM conversations WHERE id = ?', [conversationId]);
    if (convo.length === 0) return res.status(404).json({ message: 'Conversation not found' });

    const { user_one_id, user_two_id } = convo[0];
    if (req.user.id !== user_one_id && req.user.id !== user_two_id) {
      return res.status(403).json({ message: 'Not part of this conversation' });
    }

    const otherUserId = req.user.id === user_one_id ? user_two_id : user_one_id;

    const [result] = await db.query(
      'INSERT INTO direct_messages (conversation_id, sender_id, content) VALUES (?, ?, ?)',
      [conversationId, req.user.id, content.trim()]
    );

    const message = {
      id: result.insertId,
      conversation_id: Number(conversationId),
      content: content.trim(),
      created_at: new Date().toISOString(),
      sender_id: req.user.id,
      read_at: null,
    };

    // Private, unlike workspace chat — only push to the other participant's
    // personal room, not a workspace-wide room. Requires each socket to
    // join `user:${userId}` on connect (added to server.js next).
    req.io.to(`user:${otherUserId}`).emit('dm:new', message);

    res.status(201).json({ message: 'Sent', data: message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};