const db = require('../config/db');

/**
 * requireWorkspaceMember(source)
 *
 * Confirms the authenticated user (req.user.id, set by the `auth` middleware)
 * is actually a member of the workspace this request is trying to touch.
 * Without this, any logged-in user can read/edit/delete another workspace's
 * data just by changing an ID in the URL (IDOR).
 *
 * `source` tells the middleware how to figure out which workspace is involved:
 *   - 'workspace'    workspace id is req.params.id (or req.params.workspaceId)
 *   - 'body'         workspace id is req.body.workspace_id (e.g. creating a project)
 *   - 'project'      req.params.id (or .projectId/.workspaceId) is a PROJECT id;
 *                    look up which workspace that project belongs to
 *   - 'project_body' req.body.project_id is a PROJECT id; look up its workspace
 *   - 'task'         req.params.id is a TASK id; look up via task -> project -> workspace
 *
 * On success, attaches:
 *   req.workspaceId   - the resolved workspace id
 *   req.workspaceRole - the caller's role in that workspace ('admin' | 'manager' | 'member')
 */
function requireWorkspaceMember(source = 'workspace') {
  return async (req, res, next) => {
    try {
      let workspaceId;

      if (source === 'workspace') {
        workspaceId = req.params.id || req.params.workspaceId;
      } else if (source === 'body') {
        workspaceId = req.body.workspace_id;
      } else if (source === 'project') {
        const projectId = req.params.id || req.params.projectId || req.params.workspaceId;
        const [rows] = await db.query(
          'SELECT workspace_id FROM projects WHERE id = ?',
          [projectId]
        );
        if (rows.length === 0) {
          return res.status(404).json({ message: 'Project not found' });
        }
        workspaceId = rows[0].workspace_id;
      } else if (source === 'project_body') {
        const [rows] = await db.query(
          'SELECT workspace_id FROM projects WHERE id = ?',
          [req.body.project_id]
        );
        if (rows.length === 0) {
          return res.status(404).json({ message: 'Project not found' });
        }
        workspaceId = rows[0].workspace_id;
      } else if (source === 'task') {
        const taskId = req.params.id;
        const [rows] = await db.query(
          `SELECT p.workspace_id
           FROM tasks t
           JOIN projects p ON t.project_id = p.id
           WHERE t.id = ?`,
          [taskId]
        );
        if (rows.length === 0) {
          return res.status(404).json({ message: 'Task not found' });
        }
        workspaceId = rows[0].workspace_id;
      }

      if (!workspaceId) {
        return res.status(400).json({ message: 'Workspace context missing' });
      }

      const [membership] = await db.query(
        'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
        [workspaceId, req.user.id]
      );

      if (membership.length === 0) {
        return res.status(403).json({ message: 'You are not a member of this workspace' });
      }

      req.workspaceId = workspaceId;
      req.workspaceRole = membership[0].role;
      next();
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error' });
    }
  };
}

/**
 * requireRole(...allowedRoles)
 * Use AFTER requireWorkspaceMember, since it depends on req.workspaceRole.
 * e.g. requireRole('admin', 'manager') blocks plain 'member' role users.
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.workspaceRole || !allowedRoles.includes(req.workspaceRole)) {
      return res.status(403).json({ message: 'Insufficient permissions for this action' });
    }
    next();
  };
}

module.exports = { requireWorkspaceMember, requireRole };