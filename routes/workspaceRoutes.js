const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { requireWorkspaceRole } = require('../middleware/authorize');
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

// Only managers/admins can generate invite codes.
router.post('/:id/invite', auth, requireWorkspaceRole('id', 'manager'), validate('inviteMember'), inviteMember);

// Any member of the workspace can view these — but you must BE a member.
router.get('/:id/members', auth, requireWorkspaceRole('id', 'member'), getMembers);
router.get('/:id/audit-logs', auth, requireWorkspaceRole('id', 'member'), getAuditLogs);
router.get('/:id/analytics', auth, requireWorkspaceRole('id', 'member'), getAnalytics);
router.get('/:id/workload', auth, requireWorkspaceRole('id', 'member'), getWorkload);

router.post('/join', auth, joinWithCode);

module.exports = router;
