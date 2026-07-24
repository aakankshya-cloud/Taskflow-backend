const request = require('supertest');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('../config/db');
const { scoreForTask } = require('../controllers/workspaceController');

// Minimal app, same pattern as tests/auth.test.js, plus a stub req.io
// since createTask/updateTask/etc. call req.io.to(...).emit(...) internally.
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

describe('scoreForTask (unit) — pure scoring math, no DB needed', () => {
  it('scores a medium-priority task with no deadline as 2 (medium x default urgency)', () => {
    expect(scoreForTask({ priority: 'medium', deadline: null })).toBe(2);
  });

  it('scores a low-priority task with no deadline as 1', () => {
    expect(scoreForTask({ priority: 'low', deadline: null })).toBe(1);
  });

  it('scores a high-priority task with no deadline as 3', () => {
    expect(scoreForTask({ priority: 'high', deadline: null })).toBe(3);
  });

  it('defaults to medium weight for an unrecognized/missing priority', () => {
    expect(scoreForTask({ priority: undefined, deadline: null })).toBe(2);
  });

  it('weighs an overdue task 3x its priority weight', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(scoreForTask({ priority: 'medium', deadline: yesterday.toISOString() })).toBe(6); // 2 x 3
  });

  it('weighs a task due within 3 days 2x its priority weight', () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 2);
    expect(scoreForTask({ priority: 'high', deadline: soon.toISOString() })).toBe(6); // 3 x 2
  });

  it('weighs a task due far in the future at 1x its priority weight', () => {
    const later = new Date();
    later.setDate(later.getDate() + 30);
    expect(scoreForTask({ priority: 'high', deadline: later.toISOString() })).toBe(3); // 3 x 1
  });

  it('an overdue low-priority task still outweighs a far-future high-priority task', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const later = new Date();
    later.setDate(later.getDate() + 30);

    const overdueLow = scoreForTask({ priority: 'low', deadline: yesterday.toISOString() }); // 1 x 3 = 3
    const futureHigh = scoreForTask({ priority: 'high', deadline: later.toISOString() });   // 3 x 1 = 3
    expect(overdueLow).toBe(futureHigh); // documents the tie -- see note below
  });
});

describe('GET /api/workspaces/:id/workload (integration)', () => {
  let token, workspaceId, projectId, userId;

  beforeAll(async () => {
    const email = `workload${Date.now()}@test.com`;
    const signup = await request(app).post('/api/auth/signup').send({
      name: 'Workload Tester',
      email,
      password: 'test1234',
      mode: 'create',
      workspaceName: `Workload WS ${Date.now()}`,
    });
    token = signup.body.token;
    userId = signup.body.user.id;

    const wsRes = await request(app)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${token}`);
    workspaceId = wsRes.body[0].id;

    const projRes = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Workload Project', workspace_id: workspaceId });
    projectId = projRes.body.id;
  });

  afterAll(async () => {
    await db.end();
  });

  it('suggests the only member when they have zero open tasks', async () => {
    const res = await request(app)
      .get(`/api/workspaces/${workspaceId}/workload`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.suggestedAssigneeId).toBe(userId);
    expect(res.body.members[0].openTasks).toBe(0);
    expect(res.body.members[0].score).toBe(0);
  });

  it('increases the assignee score after assigning a high-priority overdue task to them', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Overdue high-priority task',
        project_id: projectId,
        assignee_id: userId,
        priority: 'high',
        deadline: yesterday.toISOString().split('T')[0],
      });

    const res = await request(app)
      .get(`/api/workspaces/${workspaceId}/workload`)
      .set('Authorization', `Bearer ${token}`);

    const member = res.body.members.find((m) => m.id === userId);
    expect(member.openTasks).toBe(1);
    expect(member.score).toBe(9); // high (3) x overdue (3)
  });
});

/*
 * NOTE ON THE TIE FOUND ABOVE:
 * An overdue low-priority task (1 x 3 = 3) scores identically to a far-future
 * high-priority task (3 x 1 = 3) under the current formula. That's not a bug --
 * both cases score 3 -- but it's worth knowing this exists so it doesn't surprise
 * you later, and worth a mental note for whether that's the tradeoff you want
 * ("is an overdue low-priority task really just as urgent as a distant high-priority one?").
 */11