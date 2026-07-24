const crypto = require('crypto');
const db = require('../config/db');
const { ROLE_RANK } = require('../middleware/authorize');

exports.createWorkspace = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Workspace name required' });

    const [result] = await db.query(
      'INSERT INTO workspaces (name, owner_id) VALUES (?, ?)',
      [name, req.user.id]
    );

    await db.query(
      'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)',
      [result.insertId, req.user.id, 'admin']
    );

    res.status(201).json({ message: 'Workspace created', id: result.insertId, name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getWorkspaces = async (req, res) => {
  try {
    const [workspaces] = await db.query(
      `SELECT w.id, w.name, wm.role 
       FROM workspaces w
       JOIN workspace_members wm ON w.id = wm.workspace_id
       WHERE wm.user_id = ?`,
      [req.user.id]
    );
    res.json(workspaces);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// NOTE: this handler now runs behind requireWorkspaceRole('id', 'manager')
// (see routes/workspaceRoutes.js), so req.membershipRole is guaranteed set
// and the caller is guaranteed to be a manager or admin of :id.
exports.inviteMember = async (req, res) => {
  try {
    const { email, role } = req.body;
    const workspaceId = req.params.id;
    const requestedRole = role || 'member';

    // A manager can invite members/managers but not admins — only an
    // admin can grant admin. Prevents privilege escalation.
    if (ROLE_RANK[requestedRole] > ROLE_RANK[req.membershipRole]) {
      return res.status(403).json({ message: 'You cannot invite someone with a higher role than your own' });
    }

    // crypto.randomBytes instead of Math.random(): Math.random() is not
    // cryptographically secure and invite codes should not be guessable.
    const code = crypto.randomBytes(4).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');

    await db.query(
      'INSERT INTO invite_codes (code, workspace_id, role, email) VALUES (?, ?, ?, ?)',
      [code, workspaceId, requestedRole, email || null]
    );

    res.json({ message: 'Invite code generated', code });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.joinWithCode = async (req, res) => {
  try {
    const { code } = req.body;
    // SECURITY FIX: the old version trusted `userId` from the request
    // body, meaning any authenticated user could add ANY other user id
    // to a workspace just by guessing/enumerating ids. The user being
    // added must always be the authenticated caller.
    const userId = req.user.id;

    const [codes] = await db.query(
      'SELECT * FROM invite_codes WHERE code = ? AND used = 0',
      [code]
    );

    if (codes.length === 0) {
      return res.status(400).json({ message: 'Invalid or already used invite code' });
    }

    const invite = codes[0];

    // If the invite was issued for a specific email, enforce it.
    if (invite.email && invite.email.toLowerCase() !== (req.user.email || '').toLowerCase()) {
      return res.status(403).json({ message: 'This invite code is not for your account' });
    }

    const [existing] = await db.query(
      'SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      [invite.workspace_id, userId]
    );

    if (existing.length > 0) {
      return res.status(400).json({ message: 'Already a member of this workspace' });
    }

    await db.query(
      'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)',
      [invite.workspace_id, userId, invite.role]
    );

    await db.query('UPDATE invite_codes SET used = 1 WHERE id = ?', [invite.id]);

    res.json({ message: 'Joined workspace successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Behind requireWorkspaceRole('id', 'member')
exports.getMembers = async (req, res) => {
  try {
    const [members] = await db.query(
      `SELECT u.id, u.name, u.email, wm.role 
       FROM workspace_members wm
       JOIN users u ON wm.user_id = u.id
       WHERE wm.workspace_id = ?`,
      [req.params.id]
    );
    res.json(members);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Behind requireWorkspaceRole('id', 'member')
exports.getAuditLogs = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100); // cap page size
    const offset = (page - 1) * limit;

    const [logs] = await db.query(
      `SELECT al.*, u.name as actor
       FROM audit_logs al
       JOIN users u ON al.user_id = u.id
       WHERE al.workspace_id = ?
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.params.id, limit, offset]
    );

    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) as total FROM audit_logs WHERE workspace_id = ?',
      [req.params.id]
    );

    res.json({
      logs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

const PRIORITY_WEIGHT = { low: 1, medium: 2, high: 3 };

function scoreForTask(task) {
  const priorityWeight = PRIORITY_WEIGHT[task.priority] || PRIORITY_WEIGHT.medium;
  let urgencyWeight = 1;
  if (task.deadline) {
    // Compare calendar dates, not exact timestamps. Diffing "now" against
    // a deadline directly is sensitive to what time of day it currently
    // is — e.g. a task due "yesterday" could still come out as "0 days
    // overdue" if less than 24 exact hours have passed. Normalizing both
    // sides to local midnight makes this an exact day count instead.
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const dueRaw = new Date(task.deadline);
    const due = new Date(dueRaw.getFullYear(), dueRaw.getMonth(), dueRaw.getDate());

    const daysUntilDue = Math.round((due - today) / (1000 * 60 * 60 * 24));
    if (daysUntilDue < 0) urgencyWeight = 3;
    else if (daysUntilDue <= 3) urgencyWeight = 2;
    else urgencyWeight = 1;
  }
  return priorityWeight * urgencyWeight;
}
exports.scoreForTask = scoreForTask; // exported so Workload.test.js can unit-test the scoring math directly

// Behind requireWorkspaceRole('id', 'member')
exports.getWorkload = async (req, res) => {
  try {
    const workspaceId = req.params.id;

    const [members] = await db.query(
      `SELECT u.id, u.name, u.email
       FROM workspace_members wm
       JOIN users u ON wm.user_id = u.id
       WHERE wm.workspace_id = ?`,
      [workspaceId]
    );

    const [openTasks] = await db.query(
      `SELECT t.assignee_id, t.priority, t.deadline
       FROM tasks t
       JOIN projects p ON t.project_id = p.id
       WHERE p.workspace_id = ? AND t.status != 'done' AND t.assignee_id IS NOT NULL`,
      [workspaceId]
    );

    const workload = members.map((member) => {
      const memberTasks = openTasks.filter((t) => String(t.assignee_id) === String(member.id));
      const score = memberTasks.reduce((sum, t) => sum + scoreForTask(t), 0);
      return { id: member.id, name: member.name, email: member.email, openTasks: memberTasks.length, score };
    });

    workload.sort((a, b) => a.score - b.score);

    res.json({
      members: workload,
      suggestedAssigneeId: workload.length > 0 ? workload[0].id : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Behind requireWorkspaceRole('id', 'member')
exports.getAnalytics = async (req, res) => {
  try {
    const workspaceId = req.params.id;

    const [totalResult] = await db.query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN t.deadline < CURDATE() AND t.status != 'done' THEN 1 ELSE 0 END) as overdue
       FROM tasks t
       JOIN projects p ON t.project_id = p.id
       WHERE p.workspace_id = ?`,
      [workspaceId]
    );

    const [tasksPerMember] = await db.query(
      `SELECT u.name, COUNT(t.id) as tasks
       FROM tasks t
       JOIN users u ON t.assignee_id = u.id
       JOIN projects p ON t.project_id = p.id
       WHERE p.workspace_id = ?
       GROUP BY u.id, u.name`,
      [workspaceId]
    );

    const [burndown] = await db.query(
      `SELECT 
        DAYNAME(t.created_at) as day,
        COUNT(*) as remaining
       FROM tasks t
       JOIN projects p ON t.project_id = p.id
       WHERE p.workspace_id = ? 
       AND t.status != 'done'
       AND t.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY DAYNAME(t.created_at), DATE(t.created_at)
       ORDER BY DATE(t.created_at)`,
      [workspaceId]
    );

    res.json({ stats: totalResult[0], tasksPerMember, burndown });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// --- Member management ---
// All three behind requireWorkspaceRole('id', 'admin') in the routes file
// except leaveWorkspace, which only needs plain membership (anyone can
// leave a workspace they belong to).

exports.changeMemberRole = async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const targetUserId = req.params.userId;
    const { role } = req.body;

    if (!['admin', 'manager', 'member'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const [target] = await db.query(
      'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      [workspaceId, targetUserId]
    );
    if (target.length === 0) return res.status(404).json({ message: 'Member not found' });

    // If we're demoting the last remaining admin, block it — otherwise
    // the workspace could end up with zero admins and nobody able to
    // manage it.
    if (target[0].role === 'admin' && role !== 'admin') {
      const [[{ adminCount }]] = await db.query(
        `SELECT COUNT(*) as adminCount FROM workspace_members WHERE workspace_id = ? AND role = 'admin'`,
        [workspaceId]
      );
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'A workspace must have at least one admin' });
      }
    }

    await db.query(
      'UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?',
      [role, workspaceId, targetUserId]
    );

    await db.query(
      'INSERT INTO audit_logs (workspace_id, user_id, action) VALUES (?, ?, ?)',
      [workspaceId, req.user.id, `Changed a member's role to ${role}`]
    );

    res.json({ message: 'Role updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.removeMember = async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const targetUserId = req.params.userId;

    if (String(targetUserId) === String(req.user.id)) {
      return res.status(400).json({ message: 'Use "Leave workspace" to remove yourself' });
    }

    const [target] = await db.query(
      'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      [workspaceId, targetUserId]
    );
    if (target.length === 0) return res.status(404).json({ message: 'Member not found' });

    if (target[0].role === 'admin') {
      const [[{ adminCount }]] = await db.query(
        `SELECT COUNT(*) as adminCount FROM workspace_members WHERE workspace_id = ? AND role = 'admin'`,
        [workspaceId]
      );
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'A workspace must have at least one admin — promote someone else first' });
      }
    }

    await db.query(
      'DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      [workspaceId, targetUserId]
    );

    // Unassign (don't delete) their tasks so work isn't silently lost.
    await db.query(
      `UPDATE tasks t JOIN projects p ON t.project_id = p.id
       SET t.assignee_id = NULL
       WHERE p.workspace_id = ? AND t.assignee_id = ?`,
      [workspaceId, targetUserId]
    );

    await db.query(
      'INSERT INTO audit_logs (workspace_id, user_id, action) VALUES (?, ?, ?)',
      [workspaceId, req.user.id, 'Removed a member from the workspace']
    );

    res.json({ message: 'Member removed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.leaveWorkspace = async (req, res) => {
  try {
    const workspaceId = req.params.id;

    const [self] = await db.query(
      'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      [workspaceId, req.user.id]
    );
    if (self.length === 0) return res.status(404).json({ message: 'You are not a member of this workspace' });

    if (self[0].role === 'admin') {
      const [[{ adminCount }]] = await db.query(
        `SELECT COUNT(*) as adminCount FROM workspace_members WHERE workspace_id = ? AND role = 'admin'`,
        [workspaceId]
      );
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'Promote another admin before leaving — a workspace can\'t have zero admins' });
      }
    }

    await db.query(
      'DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      [workspaceId, req.user.id]
    );

    await db.query(
      `UPDATE tasks t JOIN projects p ON t.project_id = p.id
       SET t.assignee_id = NULL
       WHERE p.workspace_id = ? AND t.assignee_id = ?`,
      [workspaceId, req.user.id]
    );

    res.json({ message: 'You have left the workspace' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// --- Global search within a workspace ---
// Searches across projects and tasks in one workspace at once, instead of
// having to search one project's task list at a time.
exports.search = async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const q = (req.query.q || '').trim();

    if (!q) return res.json({ projects: [], tasks: [] });
    if (q.length > 100) return res.status(400).json({ message: 'Search term too long' });

    const like = `%${q}%`;

    const [projects] = await db.query(
      `SELECT id, name, description, status FROM projects
       WHERE workspace_id = ? AND (name LIKE ? OR description LIKE ?)
       LIMIT 10`,
      [workspaceId, like, like]
    );

    const [tasks] = await db.query(
      `SELECT t.id, t.name, t.status, t.priority, t.project_id, p.name as project_name
       FROM tasks t
       JOIN projects p ON t.project_id = p.id
       WHERE p.workspace_id = ? AND (t.name LIKE ? OR t.description LIKE ?)
       LIMIT 20`,
      [workspaceId, like, like]
    );

    res.json({ projects, tasks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};