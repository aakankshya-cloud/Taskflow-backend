const db = require('../config/db');
const { getMembership, getWorkspaceIdForTask, ROLE_RANK } = require('../middleware/authorize');
const { createNotification } = require('./notificationController');

// Finds "@Full Name" mentions in a comment against the workspace's real
// member list. Checks longest names first so "@Rhea Kapoor" doesn't get
// mis-matched as just "@Rhea" if both exist.
function findMentionedMembers(content, members) {
  const sorted = [...members].sort((a, b) => b.name.length - a.name.length);
  const matched = [];
  const lowerContent = content.toLowerCase();

  for (const member of sorted) {
    const needle = `@${member.name}`.toLowerCase();
    if (lowerContent.includes(needle)) matched.push(member);
  }
  return matched;
}

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

    // --- @mentions: notify anyone tagged by name in this comment ---
    try {
      const [members] = await db.query(
        `SELECT u.id, u.name FROM workspace_members wm
         JOIN users u ON wm.user_id = u.id
         WHERE wm.workspace_id = ?`,
        [workspaceId]
      );
      const mentioned = findMentionedMembers(comment.content, members)
        .filter((m) => m.id !== req.user.id); // don't notify yourself

      for (const member of mentioned) {
        await createNotification({
          userId: member.id,
          workspaceId,
          taskId,
          type: 'mention',
          message: `${req.user.name} mentioned you in a comment`,
          io: req.io,
        });
      }
    } catch (mentionErr) {
      // Mentions are a nice-to-have on top of an already-saved comment —
      // never let this fail the request.
      console.error('Failed to process @mentions:', mentionErr);
    }

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