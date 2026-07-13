const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { createProject, getProjects } = require('../controllers/projectController');

router.post('/', auth, validate('createProject'), createProject);
router.get('/:workspaceId', auth, getProjects);

module.exports = router;