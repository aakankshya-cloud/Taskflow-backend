const db = require('../config/db');
const { getMembership, ROLE_RANK } = require('../middleware/authorize');

exports.createProject = async (req, res) => {
  try {
    const { name, description, workspace_id } = req.body;
    if (!name || !workspace_id) return res.status(400).json({ message: 'Name and workspace required' });

    // SECURITY FIX: previously anyone with a valid login could create a
    // project inside ANY workspace by just guessing/incrementing the id.
    const role = await getMembership(workspace_id, req.user.id);
    if (!role) return res.status(403).json({ message: 'You are not a member of this workspace' });
    if (ROLE_RANK[role] < ROLE_RANK.member) return res.status(403).json({ message: 'Not permitted' });

    const [result] = await db.query(
      'INSERT INTO projects (name, description, workspace_id, created_by) VALUES (?, ?, ?, ?)',
      [name, description || null, workspace_id, req.user.id]
    );

    res.status(201).json({ message: 'Project created', id: result.insertId, name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.deleteProject = async (req, res) => {
  try {
    const projectId = req.params.id;

    const [project] = await db.query('SELECT * FROM projects WHERE id = ?', [projectId]);
    if (project.length === 0) return res.status(404).json({ message: 'Project not found' });

    // SECURITY FIX: require manager/admin of the owning workspace.
    const role = await getMembership(project[0].workspace_id, req.user.id);
    if (!role || ROLE_RANK[role] < ROLE_RANK.manager) {
      return res.status(403).json({ message: 'You do not have permission to delete this project' });
    }

    await db.query(
      'DELETE FROM audit_logs WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)',
      [projectId]
    );
    await db.query('DELETE FROM tasks WHERE project_id = ?', [projectId]);
    await db.query('DELETE FROM projects WHERE id = ?', [projectId]);

    res.json({ message: 'Project deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getProjects = async (req, res) => {
  try {
    const workspaceId = req.params.workspaceId;

    // SECURITY FIX: previously any logged-in user could read the full
    // project list (names, descriptions, task counts) of ANY workspace
    // just by changing the id in the URL.
    const role = await getMembership(workspaceId, req.user.id);
    if (!role) return res.status(403).json({ message: 'You are not a member of this workspace' });

    const [projects] = await db.query(
      `SELECT p.*,
        COUNT(t.id) as taskCount,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as completedCount,
        SUM(CASE WHEN t.deadline < CURDATE() AND t.status != 'done' THEN 1 ELSE 0 END) as overdueCount
       FROM projects p
       LEFT JOIN tasks t ON t.project_id = p.id
       WHERE p.workspace_id = ?
       GROUP BY p.id`,
      [workspaceId]
    );
    res.json(projects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};
