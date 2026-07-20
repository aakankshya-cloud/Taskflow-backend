const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { createProject, getProjects, deleteProject } = require('../controllers/projectController');

router.post('/', auth, validate('createProject'), createProject);
router.get('/:workspaceId', auth, getProjects);
router.delete('/:id', auth, deleteProject); // was previously unreachable — controller existed but no route

module.exports = router;
