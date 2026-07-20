const request = require('supertest');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('../config/db');

// Same minimal-app pattern as the other test files, with a stub req.io
// so routes that emit socket events don't crash without a real socket server.
const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  req.io = { to: () => ({ emit: () => {} }) };
  next();
});
app.use('/api/auth', require('../routes/authRoutes'));
app.use('/api/workspaces', require('../routes/workspaceRoutes'));
app.use('/api/projects', require('../routes/projectRoutes'));
app.use('/api/tasks', require('../routes/taskRoutes'));

describe('Workspace access control (requireWorkspaceMember / requireRole)', () => {
  // Workspace A: owned by userA (admin), with one project and one task.
  let tokenA, workspaceAId, projectAId, taskAId;
  // Workspace B: completely separate, owned by userB. userB has NO relationship
  // to workspace A -- this is the "attacker" account for IDOR tests.
  let tokenB;
  // userC joins workspace A via invite code with role 'member' (not admin/manager),
  // to test role-gated actions like inviting others.
  let tokenC;

  beforeAll(async () => {
    // --- Set up Workspace A with an admin (userA), a project, and a task ---
    const emailA = `ownerA${Date.now()}@test.com`;
    const signupA = await request(app).post('/api/auth/signup').send({
      name: 'Owner A',
      email: emailA,
      password: 'test1234',
      mode: 'create',
      workspaceName: 'Workspace A',
    });
    tokenA = signupA.body.token;

    const wsARes = await request(app)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${tokenA}`);
    workspaceAId = wsARes.body[0].id;

    const projRes = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Project A', workspace_id: workspaceAId });
    projectAId = projRes.body.id;

    const taskRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Task A', project_id: projectAId, priority: 'medium' });
    taskAId = taskRes.body.id;

    // --- Set up a totally separate Workspace B with userB, unrelated to A ---
    const emailB = `ownerB${Date.now()}@test.com`;
    const signupB = await request(app).post('/api/auth/signup').send({
      name: 'Owner B',
      email: emailB,
      password: 'test1234',
      mode: 'create',
      workspaceName: 'Workspace B',
    });
    tokenB = signupB.body.token;

    // --- userC joins Workspace A as a plain 'member' via invite code ---
    const inviteRes = await request(app)
      .post(`/api/workspaces/${workspaceAId}/invite`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ email: 'memberC@test.com', role: 'member' });
    const inviteCode = inviteRes.body.code;

    const emailC = `memberC${Date.now()}@test.com`;
    const signupC = await request(app).post('/api/auth/signup').send({
      name: 'Member C',
      email: emailC,
      password: 'test1234',
      mode: 'join',
      inviteCode,
    });
    tokenC = signupC.body.token;
  });

  afterAll(async () => {
    await db.end();
  });

  describe('Cross-workspace access (IDOR) is blocked', () => {
    it('blocks a non-member from viewing another workspace\'s analytics', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceAId}/analytics`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.statusCode).toBe(403);
    });

    it('blocks a non-member from viewing another workspace\'s audit logs', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceAId}/audit-logs`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.statusCode).toBe(403);
    });

    it('blocks a non-member from viewing another workspace\'s workload', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceAId}/workload`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.statusCode).toBe(403);
    });

    it('blocks a non-member from listing another workspace\'s projects', async () => {
      const res = await request(app)
        .get(`/api/projects/${workspaceAId}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.statusCode).toBe(403);
    });

    it('blocks a non-member from viewing tasks in another workspace\'s project', async () => {
      const res = await request(app)
        .get(`/api/tasks/${projectAId}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.statusCode).toBe(403);
    });

    it('blocks a non-member from updating a task status in another workspace', async () => {
      const res = await request(app)
        .put(`/api/tasks/${taskAId}/status`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ status: 'done' });
      expect(res.statusCode).toBe(403);
    });

    it('blocks a non-member from deleting a task in another workspace', async () => {
      const res = await request(app)
        .delete(`/api/tasks/${taskAId}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.statusCode).toBe(403);
    });

    it('blocks a non-member from deleting a project in another workspace', async () => {
      const res = await request(app)
        .delete(`/api/projects/${projectAId}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.statusCode).toBe(403);
    });

    it('blocks a non-member from creating a task in a project they don\'t belong to', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Sneaky task', project_id: projectAId, priority: 'low' });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('Legitimate same-workspace access still works', () => {
    it('allows the workspace admin to view their own analytics', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceAId}/analytics`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.statusCode).toBe(200);
    });

    it('allows the workspace admin to list their own projects', async () => {
      const res = await request(app)
        .get(`/api/projects/${workspaceAId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.statusCode).toBe(200);
    });

    it('allows a plain member to view analytics in their own workspace (read access is fine for all roles)', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceAId}/analytics`)
        .set('Authorization', `Bearer ${tokenC}`);
      expect(res.statusCode).toBe(200);
    });
  });

  describe('Role-gated actions (requireRole)', () => {
    it('blocks a plain member from generating an invite code', async () => {
      const res = await request(app)
        .post(`/api/workspaces/${workspaceAId}/invite`)
        .set('Authorization', `Bearer ${tokenC}`)
        .send({ email: 'someone@test.com', role: 'member' });
      expect(res.statusCode).toBe(403);
    });

    it('blocks a plain member from deleting a project', async () => {
      const res = await request(app)
        .delete(`/api/projects/${projectAId}`)
        .set('Authorization', `Bearer ${tokenC}`);
      expect(res.statusCode).toBe(403);
    });

    it('allows the admin to generate an invite code', async () => {
      const res = await request(app)
        .post(`/api/workspaces/${workspaceAId}/invite`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ email: 'anotherone@test.com', role: 'member' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('joinWithCode uses the authenticated user, not a client-supplied userId', () => {
    it('ignores a userId in the request body and adds the authenticated caller instead', async () => {
      // Generate a fresh invite code as the admin
      const inviteRes = await request(app)
        .post(`/api/workspaces/${workspaceAId}/invite`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ email: 'spoofcheck@test.com', role: 'member' });
      const code = inviteRes.body.code;

      // Sign up a brand-new user who will attempt to redeem the code
      // on behalf of a spoofed userId (e.g. userB's id) instead of themselves.
      const email = `spoofcheck${Date.now()}@test.com`;
      const signup = await request(app).post('/api/auth/signup').send({
        name: 'Spoof Check',
        email,
        password: 'test1234',
      });
      const spoofToken = signup.body.token;
      const spoofUserId = signup.body.user.id;

      const joinRes = await request(app)
        .post('/api/workspaces/join')
        .set('Authorization', `Bearer ${spoofToken}`)
        .send({ code, userId: 999999 }); // attempt to spoof a different user id

      expect(joinRes.statusCode).toBe(200);

      // Confirm it's the AUTHENTICATED user who was added, not the spoofed id
      const members = await request(app)
        .get(`/api/workspaces/${workspaceAId}/members`)
        .set('Authorization', `Bearer ${tokenA}`);
      const addedIds = members.body.map((m) => m.id);

      expect(addedIds).toContain(spoofUserId);
      expect(addedIds).not.toContain(999999);
    });
  });
});