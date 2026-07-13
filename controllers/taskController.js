const db = require('../config/db');

exports.createTask = async (req, res) => {
  try {
    const { name, description, project_id, assignee_id, priority, deadline } = req.body;
    if (!name || !project_id) return res.status(400).json({ message: 'Name and project required' });

    const [result] = await db.query(
      `INSERT INTO tasks (name, description, project_id, assignee_id, priority, deadline, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, description || null, project_id, assignee_id || null, priority || 'medium', deadline || null, req.user.id]
    );

    const [workspace] = await db.query(
      'SELECT workspace_id FROM projects WHERE id = ?', [project_id]
    );

    await db.query(
      'INSERT INTO audit_logs (workspace_id, user_id, task_id, action) VALUES (?, ?, ?, ?)',
      [workspace[0].workspace_id, req.user.id, result.insertId, `Created task "${name}"`]
    );

    const newTask = {
      id: result.insertId,
      name,
      description,
      project_id,
      assignee_id,
      priority: priority || 'medium',
      deadline,
      status: 'todo',
      created_by: req.user.id
    };

    req.io.to(`workspace:${workspace[0].workspace_id}`).emit('task:created', newTask);

    res.status(201).json({ message: 'Task created', id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getTasks = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const [tasks] = await db.query(
      `SELECT t.*, u.name as assignee_name 
       FROM tasks t
       LEFT JOIN users u ON t.assignee_id = u.id
       WHERE t.project_id = ?
       LIMIT ? OFFSET ?`,
      [req.params.projectId, limit, offset]
    );

    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) as total FROM tasks WHERE project_id = ?',
      [req.params.projectId]
    );

    res.json({ tasks, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.updateTask = async (req, res) => {
  try {
    const taskId = req.params.id;
    const { name, description, priority, deadline, assignee_id } = req.body;

    const [task] = await db.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (task.length === 0) return res.status(404).json({ message: 'Task not found' });

    await db.query(
      `UPDATE tasks SET 
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        priority = COALESCE(?, priority),
        deadline = COALESCE(?, deadline),
        assignee_id = ?
       WHERE id = ?`,
      [name || null, description || null, priority || null, deadline || null, assignee_id ?? task[0].assignee_id, taskId]
    );

    const [workspace] = await db.query(
      'SELECT workspace_id FROM projects WHERE id = ?', [task[0].project_id]
    );

    await db.query(
      'INSERT INTO audit_logs (workspace_id, user_id, task_id, action) VALUES (?, ?, ?, ?)',
      [workspace[0].workspace_id, req.user.id, taskId, `Updated task "${name || task[0].name}"`]
    );

    req.io.to(`workspace:${workspace[0].workspace_id}`).emit('task:updated', {
      id: parseInt(taskId),
      name: name || task[0].name,
      description: description || task[0].description,
      priority: priority || task[0].priority,
      deadline: deadline || task[0].deadline,
      assignee_id: assignee_id ?? task[0].assignee_id,
    });

    res.json({ message: 'Task updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.updateTaskStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const taskId = req.params.id;

    const statusMap = {
      "To Do": "todo", "In Progress": "in_progress",
      "In Review": "in_review", "Done": "done",
      "todo": "todo", "in_progress": "in_progress",
      "in_review": "in_review", "done": "done",
    };

    const dbStatus = statusMap[status];
    if (!dbStatus) return res.status(400).json({ message: `Invalid status: ${status}` });

    const [task] = await db.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (task.length === 0) return res.status(404).json({ message: 'Task not found' });

    await db.query('UPDATE tasks SET status = ? WHERE id = ?', [dbStatus, taskId]);

    const [workspace] = await db.query(
      'SELECT workspace_id FROM projects WHERE id = ?', [task[0].project_id]
    );

    await db.query(
      'INSERT INTO audit_logs (workspace_id, user_id, task_id, action) VALUES (?, ?, ?, ?)',
      [workspace[0].workspace_id, req.user.id, taskId, `Moved task "${task[0].name}" to ${dbStatus}`]
    );

    req.io.to(`workspace:${workspace[0].workspace_id}`).emit('task:updated', {
      id: parseInt(taskId),
      status: dbStatus
    });

    res.json({ message: 'Task status updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    const taskId = req.params.id;

    const [task] = await db.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (task.length === 0) return res.status(404).json({ message: 'Task not found' });

    const [workspace] = await db.query(
      'SELECT workspace_id FROM projects WHERE id = ?', [task[0].project_id]
    );

    await db.query('DELETE FROM audit_logs WHERE task_id = ?', [taskId]);
    await db.query('DELETE FROM tasks WHERE id = ?', [taskId]);

    req.io.to(`workspace:${workspace[0].workspace_id}`).emit('task:deleted', {
      id: parseInt(taskId)
    });

    res.json({ message: 'Task deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};