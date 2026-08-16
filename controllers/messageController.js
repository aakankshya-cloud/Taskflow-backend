const db = require('../config/db');
const { getMembership } = require('../middleware/authorize');
const { createNotification } = require('./notificationController');
exports.getMessages = async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const role = await getMembership(workspaceId, req.user.id);
    if (!role) return res.status(403).json({ message: 'You are not a member of this workspace' });

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before; // message id, for pagination — load older messages

    const params = [workspaceId];
    let whereClause = 'm.workspace_id = ?';
    if (before) {
      whereClause += ' AND m.id < ?';
      params.push(before);
    }

    const [messages] = await db.query(
      `SELECT m.id, m.content, m.created_at, m.user_id, u.name as user_name
       FROM messages m
       JOIN users u ON m.user_id = u.id
       WHERE ${whereClause}
       ORDER BY m.id DESC
       LIMIT ?`,
      [...params, limit]
    );

    // Return oldest-first so the frontend can just append to the bottom.
    res.json({ messages: messages.reverse() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'Message content is required' });
    }
    if (content.length > 2000) {
      return res.status(400).json({ message: 'Message is too long' });
    }

    const role = await getMembership(workspaceId, req.user.id);
    if (!role) return res.status(403).json({ message: 'You are not a member of this workspace' });

    const [result] = await db.query(
      'INSERT INTO messages (workspace_id, user_id, content) VALUES (?, ?, ?)',
      [workspaceId, req.user.id, content.trim()]
    );

    const message = {
      id: result.insertId,
      content: content.trim(),
      created_at: new Date().toISOString(),
      user_id: req.user.id,
      user_name: req.user.name,
    };

    // Same room already used for task/notification events — no new
    // join logic needed on the socket side.
    req.io.to(`workspace:${workspaceId}`).emit('message:new', message);

    res.status(201).json({ message: 'Sent', data: message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};
exports.sendMessage = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'Message content is required' });
    }
    if (content.length > 2000) {
      return res.status(400).json({ message: 'Message is too long' });
    }

    const role = await getMembership(workspaceId, req.user.id);
    if (!role) return res.status(403).json({ message: 'You are not a member of this workspace' });

    const [result] = await db.query(
      'INSERT INTO messages (workspace_id, user_id, content) VALUES (?, ?, ?)',
      [workspaceId, req.user.id, content.trim()]
    );

    const message = {
      id: result.insertId,
      content: content.trim(),
      created_at: new Date().toISOString(),
      user_id: req.user.id,
      user_name: req.user.name,
    };

    req.io.to(`workspace:${workspaceId}`).emit('message:new', message);

    // Notify every other workspace member — a chat message doesn't have
    // one specific recipient like a task assignment does, so everyone
    // except the sender gets one. Wrapped separately, same reasoning as
    // task notifications: a notification failure must never make a
    // successfully-sent message look like it failed.
    try {
      const [members] = await db.query(
        'SELECT user_id FROM workspace_members WHERE workspace_id = ? AND user_id != ?',
        [workspaceId, req.user.id]
      );

      const preview = content.trim().length > 60
        ? content.trim().slice(0, 60) + '...'
        : content.trim();

      await Promise.all(
        members.map((m) =>
          createNotification({
            userId: m.user_id,
            workspaceId,
            taskId: null,
            type: 'chat_message',
            message: `${req.user.name}: ${preview}`,
            io: req.io,
          })
        )
      );
    } catch (notifyErr) {
      console.error('Failed to send chat notifications:', notifyErr);
    }

    res.status(201).json({ message: 'Sent', data: message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};