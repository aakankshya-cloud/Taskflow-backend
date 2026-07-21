const request = require('supertest');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => { req.io = { to: () => ({ emit: () => {} }) }; next(); }); // stub socket.io
app.use('/api/auth', require('../routes/authRoutes'));
app.use('/api/workspaces', require('../routes/workspaceRoutes'));
app.use('/api/projects', require('../routes/projectRoutes'));
app.use('/api/tasks', require('../routes/taskRoutes'));

async function signup(email) {
  const res = await request(app).post('/api/auth/signup').send({
    name: 'User',
    email,
    password: 'test1234',
    mode: 'create',
    workspaceName: `WS-${Date.now()}-${Math.random()}`,
  });
  return res.body; // { token, user }
}

describe('Access control on workspace-scoped routes', () => {
  it('a user who is NOT a workspace member cannot read its projects', async () => {
    const owner = await signup(`owner${Date.now()}@test.com`);
    const outsider = await signup(`outsider${Date.now()}@test.com`);

    // owner creates a workspace via signup(mode: create) above; find its id
    const wsRes = await request(app)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${owner.token}`);
    const workspaceId = wsRes.body[0].id;

    const res = await request(app)
      .get(`/api/projects/${workspaceId}`)
      .set('Authorization', `Bearer ${outsider.token}`);

    expect(res.statusCode).toBe(403);
  });

  it('a user cannot create a project in a workspace they do not belong to', async () => {
    const owner = await signup(`owner2${Date.now()}@test.com`);
    const outsider = await signup(`outsider2${Date.now()}@test.com`);

    const wsRes = await request(app)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${owner.token}`);
    const workspaceId = wsRes.body[0].id;

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ name: 'Hostile project', workspace_id: workspaceId });

    expect(res.statusCode).toBe(403);
  });

  it('joining a workspace always adds the AUTHENTICATED user, ignoring any userId in the body', async () => {
    const owner = await signup(`owner3${Date.now()}@test.com`);
    const attacker = await signup(`attacker${Date.now()}@test.com`);
    const victim = await signup(`victim${Date.now()}@test.com`);

    const wsRes = await request(app)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${owner.token}`);
    const workspaceId = wsRes.body[0].id;

    const inviteRes = await request(app)
      .post(`/api/workspaces/${workspaceId}/invite`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ email: null, role: 'member' });
    const code = inviteRes.body.code;

    // attacker tries to join AS the victim by spoofing userId
    await request(app)
      .post('/api/workspaces/join')
      .set('Authorization', `Bearer ${attacker.token}`)
      .send({ code, userId: victim.user.id });

    const membersRes = await request(app)
      .get(`/api/workspaces/${workspaceId}/members`)
      .set('Authorization', `Bearer ${owner.token}`);

    const memberEmails = membersRes.body.map((m) => m.email);
    expect(memberEmails).toContain(attacker.user.email); // attacker was added
    expect(memberEmails).not.toContain(victim.user.email); // victim was NOT added
  });
});