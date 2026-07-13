const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  createWorkspace,
  getWorkspaces,
  inviteMember,
  getMembers,
  getAuditLogs,
  getAnalytics,
  getWorkload,
  joinWithCode
} = require('../controllers/workspaceController');

router.post('/', auth, createWorkspace);
router.get('/', auth, getWorkspaces);
router.post('/:id/invite', auth, inviteMember);
router.get('/:id/members', auth, getMembers);
router.get('/:id/audit-logs', auth, getAuditLogs);
router.get('/:id/analytics', auth, getAnalytics);
router.get('/:id/workload', auth, getWorkload);
router.post('/join', auth, joinWithCode);

module.exports = router;