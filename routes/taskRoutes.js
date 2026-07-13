
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { createTask, getTasks, updateTask, updateTaskStatus, deleteTask } = require('../controllers/taskController');

router.post('/', auth, validate('createTask'), createTask);
router.get('/:projectId', auth, getTasks);
router.put('/:id', auth, updateTask);
router.put('/:id/status', auth, updateTaskStatus);
router.delete('/:id', auth, deleteTask);
module.exports = router;