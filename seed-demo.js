// seed-demo.js
//
// Creates (or reuses) a demo login so recruiters/reviewers can explore
// Flowspace without signing up: a demo admin, a few teammates, two
// projects, tasks across every status/priority/deadline combination,
// plus notifications, workspace chat history, and a DM thread — so
// every feature (Kanban, Dashboard, Analytics, Audit Log, Notifications,
// Chat, Messages) has something real to show on first login.
//
// Safe to re-run: it checks for the demo user by email before creating
// anything, and exits early if the demo workspace already exists.
//
// Usage:
//   node seed-demo.js

const bcrypt = require('bcrypt');
const db = require('./config/db');
const { createNotification } = require('./controllers/notificationController');

const DEMO_EMAIL = 'demo@flowspace.io';
const DEMO_PASSWORD = 'DemoPass123!';

const TEAMMATES = [
  { name: 'Arjun Mehta', email: 'arjun@flowspace.io' },
  { name: 'Rhea Kapoor', email: 'rhea@flowspace.io' },
  { name: 'Priya Sharma', email: 'priya@flowspace.io' },
];

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function getOrCreateUser(name, email, password) {
  const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length > 0) return existing[0].id;

  const hashed = await bcrypt.hash(password, 10);
  const [result] = await db.query(
    'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
    [name, email, hashed]
  );
  return result.insertId;
}

async function seed() {
  console.log('Seeding demo data...');

  const demoUserId = await getOrCreateUser('Demo Admin', DEMO_EMAIL, DEMO_PASSWORD);

  const teammateIds = [];
  for (const t of TEAMMATES) {
    const id = await getOrCreateUser(t.name, t.email, Math.random().toString(36));
    teammateIds.push(id);
  }

  const [existingWorkspaces] = await db.query(
    'SELECT id FROM workspaces WHERE owner_id = ? AND name = ?',
    [demoUserId, 'Flowspace Demo']
  );

  let workspaceId;
  if (existingWorkspaces.length > 0) {
    workspaceId = existingWorkspaces[0].id;
    console.log('Demo workspace already exists, skipping data creation.');
    printCredentials();
    return;
  }

  const [workspaceResult] = await db.query(
    'INSERT INTO workspaces (name, owner_id) VALUES (?, ?)',
    ['Flowspace Demo', demoUserId]
  );
  workspaceId = workspaceResult.insertId;

  await db.query(
    'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)',
    [workspaceId, demoUserId, 'admin']
  );
  for (const id of teammateIds) {
    await db.query(
      'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)',
      [workspaceId, id, 'member']
    );
  }

  const [websiteProject] = await db.query(
    'INSERT INTO projects (name, description, workspace_id, created_by) VALUES (?, ?, ?, ?)',
    ['Website Redesign', 'Refresh the marketing site ahead of launch', workspaceId, demoUserId]
  );
  const [mobileProject] = await db.query(
    'INSERT INTO projects (name, description, workspace_id, created_by) VALUES (?, ?, ?, ?)',
    ['Mobile App Launch', 'Ship v1 of the iOS/Android app', workspaceId, demoUserId]
  );

  const [arjunId, rheaId, priyaId] = teammateIds;

  const tasks = [
    { project: websiteProject.insertId, name: 'Wireframe new homepage', status: 'done', priority: 'high', assignee: arjunId, deadline: daysFromNow(-5) },
    { project: websiteProject.insertId, name: 'Migrate blog to new CMS', status: 'done', priority: 'medium', assignee: rheaId, deadline: daysFromNow(-2) },
    { project: websiteProject.insertId, name: 'Design pricing page', status: 'in_review', priority: 'high', assignee: rheaId, deadline: daysFromNow(2) },
    { project: websiteProject.insertId, name: 'Rewrite landing page copy', status: 'in_progress', priority: 'medium', assignee: priyaId, deadline: daysFromNow(4) },
    { project: websiteProject.insertId, name: 'Fix mobile nav overlap', status: 'in_progress', priority: 'high', assignee: arjunId, deadline: daysFromNow(-1) },
    { project: websiteProject.insertId, name: 'Add cookie consent banner', status: 'todo', priority: 'low', assignee: priyaId, deadline: daysFromNow(10) },
    { project: websiteProject.insertId, name: 'Set up analytics tracking', status: 'todo', priority: 'medium', assignee: null, deadline: daysFromNow(7) },
    { project: websiteProject.insertId, name: 'Audit accessibility (WCAG AA)', status: 'todo', priority: 'high', assignee: null, deadline: daysFromNow(14) },

    { project: mobileProject.insertId, name: 'Finalize onboarding flow', status: 'done', priority: 'high', assignee: priyaId, deadline: daysFromNow(-8) },
    { project: mobileProject.insertId, name: 'Push notification permissions UX', status: 'in_review', priority: 'medium', assignee: arjunId, deadline: daysFromNow(3) },
    { project: mobileProject.insertId, name: 'Integrate crash reporting', status: 'in_progress', priority: 'high', assignee: rheaId, deadline: daysFromNow(1) },
    { project: mobileProject.insertId, name: 'App Store screenshots', status: 'in_progress', priority: 'low', assignee: arjunId, deadline: daysFromNow(6) },
    { project: mobileProject.insertId, name: 'Beta tester feedback triage', status: 'todo', priority: 'medium', assignee: rheaId, deadline: daysFromNow(-3) },
    { project: mobileProject.insertId, name: 'Write release notes', status: 'todo', priority: 'low', assignee: null, deadline: daysFromNow(12) },
  ];

  const taskIds = {}; // name -> insertId, so we can reference specific tasks below
  for (const t of tasks) {
    const [result] = await db.query(
      `INSERT INTO tasks (name, description, project_id, assignee_id, priority, deadline, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [t.name, '', t.project, t.assignee, t.priority, t.deadline, t.status, demoUserId]
    );
    taskIds[t.name] = result.insertId;

    await db.query(
      'INSERT INTO audit_logs (workspace_id, user_id, task_id, action) VALUES (?, ?, ?, ?)',
      [workspaceId, demoUserId, result.insertId, `Created task "${t.name}"`]
    );
  }

  console.log('Demo data created.');

  // --- Notifications ---
  // No `io` passed — there's no live socket connection during seeding,
  // this just writes rows so GET /notifications has history on first login.
  await createNotification({
    userId: arjunId,
    workspaceId,
    taskId: taskIds['Wireframe new homepage'],
    type: 'task_assigned',
    message: 'Demo Admin assigned you to "Wireframe new homepage"',
  });
  await createNotification({
    userId: rheaId,
    workspaceId,
    taskId: taskIds['Design pricing page'],
    type: 'status_changed',
    message: 'Demo Admin moved "Design pricing page" to in review',
  });
  await createNotification({
    userId: priyaId,
    workspaceId,
    taskId: taskIds['Rewrite landing page copy'],
    type: 'task_assigned',
    message: 'Demo Admin assigned you to "Rewrite landing page copy"',
  });
  await createNotification({
    userId: demoUserId,
    workspaceId,
    taskId: taskIds['Integrate crash reporting'],
    type: 'status_changed',
    message: 'Rhea Kapoor moved "Integrate crash reporting" to in progress',
  });

  // --- Workspace chat history ---
  const chatMessages = [
    { userId: demoUserId, content: 'Morning team — quick heads up, pricing page design is due Wednesday.' },
    { userId: rheaId, content: 'On it! Should have a draft up for review by tomorrow.' },
    { userId: arjunId, content: 'Nav overlap bug is fixed on my end, pushing shortly.' },
    { userId: priyaId, content: 'Nice, I\'ll re-test on mobile once it\'s live.' },
    { userId: demoUserId, content: 'Great progress everyone, keep it up!' },
  ];
  for (const m of chatMessages) {
    await db.query(
      'INSERT INTO messages (workspace_id, user_id, content) VALUES (?, ?, ?)',
      [workspaceId, m.userId, m.content]
    );
  }

  // --- A DM thread between the demo admin and one teammate ---
  const [userOne, userTwo] = Number(demoUserId) < Number(rheaId) ? [demoUserId, rheaId] : [rheaId, demoUserId];
  const [convoResult] = await db.query(
    'INSERT INTO conversations (workspace_id, user_one_id, user_two_id) VALUES (?, ?, ?)',
    [workspaceId, userOne, userTwo]
  );
  const conversationId = convoResult.insertId;

  const dmMessages = [
    { senderId: demoUserId, content: 'Hey, how\'s the pricing page coming along?' },
    { senderId: rheaId, content: 'Good! Should have something to show you by end of day.' },
    { senderId: demoUserId, content: 'Perfect, thank you!' },
  ];
  for (const m of dmMessages) {
    await db.query(
      'INSERT INTO direct_messages (conversation_id, sender_id, content) VALUES (?, ?, ?)',
      [conversationId, m.senderId, m.content]
    );
  }

  console.log('Notifications, chat, and DM history seeded.');
  printCredentials();
}

function printCredentials() {
  console.log('\n--- Demo login ---');
  console.log(`Email:    ${DEMO_EMAIL}`);
  console.log(`Password: ${DEMO_PASSWORD}`);
  console.log('------------------\n');
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    db.end();
  });