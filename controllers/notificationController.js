const db = require('../config/db');

exports.getNotifications = async (req, res) => {
  try {
    const [notifications] = await db.query(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    const [[{ unread }]] = await db.query(
      `SELECT COUNT(*) as unread FROM notifications WHERE user_id = ? AND read_at IS NULL`,
      [req.user.id]
    );
    res.json({ notifications, unread });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.markRead = async (req, res) => {
  try {
    // Only mark the caller's own notifications — never trust an id alone.
    await db.query(
      `UPDATE notifications SET read_at = NOW() WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Marked as read' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    await db.query(
      `UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL`,
      [req.user.id]
    );
    res.json({ message: 'All marked as read' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Helper other controllers can call — not a route handler.
exports.createNotification = async ({ userId, workspaceId, taskId, type, message, io }) => {
  const [result] = await db.query(
    `INSERT INTO notifications (user_id, workspace_id, task_id, type, message) VALUES (?, ?, ?, ?, ?)`,
    [userId, workspaceId, taskId || null, type, message]
  );
  const notification = { id: result.insertId, user_id: userId, workspace_id: workspaceId, task_id: taskId, type, message, read_at: null };
  if (io) io.to(`workspace:${workspaceId}`).emit('notification:new', notification);
  return notification;
};