const db = require('../config/db');
const { getMembership, getWorkspaceIdForTask, ROLE_RANK } = require('../middleware/authorize');

exports.getComments = async (req, res) => {
  try {
    const taskId = req.params.taskId;

    const workspaceId = await getWorkspaceIdForTask(taskId);
    if (!workspaceId) return res.status(404).json({ message: 'Task not found' });

    const role = await getMembership(workspaceId, req.user.id);
    if (!role) return res.status(403).json({ message: 'You are not a member of this workspace' });

    const [comments] = await db.query(
      `SELECT c.id, c.content, c.created_at, u.id as user_id, u.name as user_name
       FROM task_comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.task_id = ?
       ORDER BY c.created_at ASC`,
      [taskId]
    );

    res.json(comments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.addComment = async (req, res) => {
  try {
    const taskId = req.params.taskId;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'Comment cannot be empty' });
    }
    if (content.length > 2000) {
      return res.status(400).json({ message: 'Comment is too long (max 2000 characters)' });
    }

    const workspaceId = await getWorkspaceIdForTask(taskId);
    if (!workspaceId) return res.status(404).json({ message: 'Task not found' });

    const role = await getMembership(workspaceId, req.user.id);
    if (!role) return res.status(403).json({ message: 'You are not a member of this workspace' });

    const [result] = await db.query(
      'INSERT INTO task_comments (task_id, user_id, content) VALUES (?, ?, ?)',
      [taskId, req.user.id, content.trim()]
    );

    const comment = {
      id: result.insertId,
      task_id: Number(taskId),
      content: content.trim(),
      created_at: new Date().toISOString(),
      user_id: req.user.id,
      user_name: req.user.name,
    };

    // Log it in the audit trail too, consistent with other task actions.
    await db.query(
      'INSERT INTO audit_logs (workspace_id, user_id, task_id, action) VALUES (?, ?, ?, ?)',
      [workspaceId, req.user.id, taskId, 'Commented on task']
    );

    req.io.to(`workspace:${workspaceId}`).emit('comment:created', comment);

    res.status(201).json(comment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.deleteComment = async (req, res) => {
  try {
    const commentId = req.params.id;

    const [rows] = await db.query('SELECT * FROM task_comments WHERE id = ?', [commentId]);
    if (rows.length === 0) return res.status(404).json({ message: 'Comment not found' });
    const comment = rows[0];

    const workspaceId = await getWorkspaceIdForTask(comment.task_id);
    const role = await getMembership(workspaceId, req.user.id);
    if (!role) return res.status(403).json({ message: 'You are not a member of this workspace' });

    // Only the comment's author, or a manager/admin, can delete it.
    const isAuthor = comment.user_id === req.user.id;
    const isElevated = ROLE_RANK[role] >= ROLE_RANK.manager;
    if (!isAuthor && !isElevated) {
      return res.status(403).json({ message: 'You do not have permission to delete this comment' });
    }

    await db.query('DELETE FROM task_comments WHERE id = ?', [commentId]);
    req.io.to(`workspace:${workspaceId}`).emit('comment:deleted', { id: Number(commentId), task_id: comment.task_id });

    res.json({ message: 'Comment deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};