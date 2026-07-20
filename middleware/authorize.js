// middleware/authorize.js
//
// Centralized authorization helpers. The old codebase checked "is this a
// valid JWT?" (middleware/auth.js) but never checked "does this user
// actually belong to the workspace/project/task they're touching?".
// That's a Broken Object Level Authorization (BOLA/IDOR) bug on almost
// every workspace-scoped route. These helpers fix that in one place so
// every controller can reuse them instead of re-implementing the check
// (and forgetting it) each time.

const db = require('../config/db');

const ROLE_RANK = { member: 1, manager: 2, admin: 3 };

/**
 * Look up the requesting user's membership row for a workspace.
 * Returns null if they are not a member.
 */
async function getMembership(workspaceId, userId) {
  const [rows] = await db.query(
    'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
    [workspaceId, userId]
  );
  return rows.length ? rows[0].role : null;
}

/**
 * Middleware factory: require the user to be a member of the workspace
 * identified by req.params[paramName], with at least `minRole`.
 * Attaches req.membershipRole for downstream handlers.
 */
function requireWorkspaceRole(paramName = 'id', minRole = 'member') {
  return async (req, res, next) => {
    try {
      const workspaceId = req.params[paramName];
      const role = await getMembership(workspaceId, req.user.id);
      if (!role) {
        return res.status(403).json({ message: 'You are not a member of this workspace' });
      }
      if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
        return res.status(403).json({ message: 'You do not have permission to do this' });
      }
      req.membershipRole = role;
      next();
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error' });
    }
  };
}

/** Resolve which workspace a project belongs to. */
async function getWorkspaceIdForProject(projectId) {
  const [rows] = await db.query('SELECT workspace_id FROM projects WHERE id = ?', [projectId]);
  return rows.length ? rows[0].workspace_id : null;
}

/** Resolve which workspace a task belongs to (via its project). */
async function getWorkspaceIdForTask(taskId) {
  const [rows] = await db.query(
    `SELECT p.workspace_id FROM tasks t
     JOIN projects p ON t.project_id = p.id
     WHERE t.id = ?`,
    [taskId]
  );
  return rows.length ? rows[0].workspace_id : null;
}

module.exports = {
  getMembership,
  requireWorkspaceRole,
  getWorkspaceIdForProject,
  getWorkspaceIdForTask,
  ROLE_RANK,
};
