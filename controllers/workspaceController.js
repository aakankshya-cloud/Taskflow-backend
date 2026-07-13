const db = require('../config/db');

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

exports.inviteMember = async (req, res) => {
  try {
    const { email, role } = req.body;
    const workspaceId = req.params.id;

    // Generate a random invite code like 8F92-KD01
    const code = Math.random().toString(36).substring(2, 6).toUpperCase() +
      '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    await db.query(
      'INSERT INTO invite_codes (code, workspace_id, role, email) VALUES (?, ?, ?, ?)',
      [code, workspaceId, role || 'member', email || null]
    );

    res.json({ message: 'Invite code generated', code });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.joinWithCode = async (req, res) => {
  try {
    const { code, userId } = req.body;

    // Find the invite code
    const [codes] = await db.query(
      'SELECT * FROM invite_codes WHERE code = ? AND used = 0',
      [code]
    );

    if (codes.length === 0) {
      return res.status(400).json({ message: 'Invalid or already used invite code' });
    }

    const invite = codes[0];

    // Check if user is already a member
    const [existing] = await db.query(
      'SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      [invite.workspace_id, userId]
    );

    if (existing.length > 0) {
      return res.status(400).json({ message: 'Already a member of this workspace' });
    }

    // Add user to workspace
    await db.query(
      'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)',
      [invite.workspace_id, userId, invite.role]
    );

    // Mark code as used
    await db.query('UPDATE invite_codes SET used = 1 WHERE id = ?', [invite.id]);

    res.json({ message: 'Joined workspace successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};
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
exports.getAuditLogs = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
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
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};
// Workload balancer: scores each member's current open workload as
// sum(priority_weight x urgency_weight) across their open (non-done) tasks,
// and returns the lowest-scoring member as the suggested assignee for a new task.
const PRIORITY_WEIGHT = { low: 1, medium: 2, high: 3 };

function scoreForTask(task) {
  const priorityWeight = PRIORITY_WEIGHT[task.priority] || PRIORITY_WEIGHT.medium;

  // Urgency: overdue tasks weigh most, then tasks due soon, then everything else.
  let urgencyWeight = 1;
  if (task.deadline) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(task.deadline);
    const daysUntilDue = Math.ceil((due - today) / (1000 * 60 * 60 * 24));

    if (daysUntilDue < 0) urgencyWeight = 3; // overdue
    else if (daysUntilDue <= 3) urgencyWeight = 2; // due soon
    else urgencyWeight = 1;
  }

  return priorityWeight * urgencyWeight;
}

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
      const memberTasks = openTasks.filter(
        (t) => String(t.assignee_id) === String(member.id)
      );
      const score = memberTasks.reduce((sum, t) => sum + scoreForTask(t), 0);

      return {
        id: member.id,
        name: member.name,
        email: member.email,
        openTasks: memberTasks.length,
        score,
      };
    });

    workload.sort((a, b) => a.score - b.score);

    res.json({
      members: workload,
      // Lightest-weighted member gets the nod; ties broken by whoever has fewer open tasks.
      suggestedAssigneeId: workload.length > 0 ? workload[0].id : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

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

    res.json({
      stats: totalResult[0],
      tasksPerMember,
      burndown
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};