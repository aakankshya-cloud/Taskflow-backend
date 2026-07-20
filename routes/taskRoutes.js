const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { requireWorkspaceMember } = require('../middleware/workspaceAccess');
const { createTask, getTasks, updateTask, updateTaskStatus, deleteTask } = require('../controllers/taskController');

// project_id comes from the body here, so resolve the workspace via that project
router.post('/', auth, validate('createTask'), requireWorkspaceMember('project_body'), createTask);

// :projectId identifies a project directly -- resolve its workspace and check membership
router.get('/:projectId', auth, requireWorkspaceMember('project'), getTasks);

// :id is a TASK id on these three -- resolve task -> project -> workspace
router.put('/:id', auth, validate('updateTask'), requireWorkspaceMember('task'), updateTask);
router.put('/:id/status', auth, requireWorkspaceMember('task'), updateTaskStatus);
router.delete('/:id', auth, requireWorkspaceMember('task'), deleteTask);

module.exports = router;