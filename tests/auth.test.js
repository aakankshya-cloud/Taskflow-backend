const request = require('supertest');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Build a minimal app for testing
const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/auth', require('../routes/authRoutes'));
app.use('/api/workspaces', require('../routes/workspaceRoutes'));
app.use('/api/tasks', require('../routes/taskRoutes'));

describe('Auth Endpoints', () => {
  it('POST /api/auth/signup — should create a new user', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      name: 'Test User',
      email: `test${Date.now()}@test.com`,
      password: 'test1234',
      mode: 'create',
      workspaceName: `Test Workspace ${Date.now()}-${Math.random()}`
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toHaveProperty('email');
  });

  it('POST /api/auth/signup — should reject duplicate email', async () => {
    const email = `dup${Date.now()}@test.com`;
    await request(app).post('/api/auth/signup').send({
      name: 'User', email, password: 'test1234', mode: 'create', workspaceName: `WS-${Date.now()}-${Math.random()}`
    });
    const res = await request(app).post('/api/auth/signup').send({
      name: 'User2', email, password: 'test1234', mode: 'create', workspaceName: `WS2-${Date.now()}-${Math.random()}`
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Email already registered');
  });

  it('POST /api/auth/login — should login successfully', async () => {
    const email = `login${Date.now()}@test.com`;
    await request(app).post('/api/auth/signup').send({
      name: 'Login User', email, password: 'test1234', mode: 'create', workspaceName: `WS-${Date.now()}-${Math.random()}`
    });
    const res = await request(app).post('/api/auth/login').send({ email, password: 'test1234' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('token');
  });

  it('POST /api/auth/login — should reject wrong password', async () => {
    const email = `wrong${Date.now()}@test.com`;
    await request(app).post('/api/auth/signup').send({
      name: 'User', email, password: 'test1234', mode: 'create', workspaceName: `WS-${Date.now()}-${Math.random()}`
    });
    const res = await request(app).post('/api/auth/login').send({ email, password: 'wrongpass' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/auth/login — should reject missing fields', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'test@test.com' });
    expect(res.statusCode).toBe(400);
  });
});
