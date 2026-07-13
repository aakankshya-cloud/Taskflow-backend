// seed-demo.js
//
// Creates (or reuses) a demo login so recruiters/reviewers can explore
// Flowspace without signing up: a demo admin, a few teammates, two
// projects, and a spread of tasks across every status/priority/deadline
// combination so the Kanban board, Dashboard, Analytics, Audit Log, and
// Workload Balancer all have something real to show.
//
// Safe to re-run: it checks for the demo user by email before creating
// anything, and exits early if the demo workspace already exists.
//
// Usage:
//   node seed-demo.js

const bcrypt = require('bcrypt');
const db = require('./config/db');

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

  // 1. Demo admin (the account recruiters will log in as) + teammates
  const demoUserId = await getOrCreateUser('Demo Admin', DEMO_EMAIL, DEMO_PASSWORD);

  const teammateIds = [];
  for (const t of TEAMMATES) {
    // Random unusable password — these accounts exist only to be assignees.
    const id = await getOrCreateUser(t.name, t.email, Math.random().toString(36));
    teammateIds.push(id);
  }

  // 2. Workspace (skip everything else if it already exists)
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

  // 3. Projects
  const [websiteProject] = await db.query(
    'INSERT INTO projects (name, description, workspace_id, created_by) VALUES (?, ?, ?, ?)',
    ['Website Redesign', 'Refresh the marketing site ahead of launch', workspaceId, demoUserId]
  );
  const [mobileProject] = await db.query(
    'INSERT INTO projects (name, description, workspace_id, created_by) VALUES (?, ?, ?, ?)',
    ['Mobile App Launch', 'Ship v1 of the iOS/Android app', workspaceId, demoUserId]
  );

  const [arjunId, rheaId, priyaId] = teammateIds;

  // 4. Tasks — spread across statuses, priorities, assignees and deadlines
  //    (including a couple overdue ones) so every dashboard view has data.
  const tasks = [
    // Website Redesign
    { project: websiteProject.insertId, name: 'Wireframe new homepage', status: 'done', priority: 'high', assignee: arjunId, deadline: daysFromNow(-5) },
    { project: websiteProject.insertId, name: 'Migrate blog to new CMS', status: 'done', priority: 'medium', assignee: rheaId, deadline: daysFromNow(-2) },
    { project: websiteProject.insertId, name: 'Design pricing page', status: 'in_review', priority: 'high', assignee: rheaId, deadline: daysFromNow(2) },
    { project: websiteProject.insertId, name: 'Rewrite landing page copy', status: 'in_progress', priority: 'medium', assignee: priyaId, deadline: daysFromNow(4) },
    { project: websiteProject.insertId, name: 'Fix mobile nav overlap', status: 'in_progress', priority: 'high', assignee: arjunId, deadline: daysFromNow(-1) },
    { project: websiteProject.insertId, name: 'Add cookie consent banner', status: 'todo', priority: 'low', assignee: priyaId, deadline: daysFromNow(10) },
    { project: websiteProject.insertId, name: 'Set up analytics tracking', status: 'todo', priority: 'medium', assignee: null, deadline: daysFromNow(7) },
    { project: websiteProject.insertId, name: 'Audit accessibility (WCAG AA)', status: 'todo', priority: 'high', assignee: null, deadline: daysFromNow(14) },

    // Mobile App Launch
    { project: mobileProject.insertId, name: 'Finalize onboarding flow', status: 'done', priority: 'high', assignee: priyaId, deadline: daysFromNow(-8) },
    { project: mobileProject.insertId, name: 'Push notification permissions UX', status: 'in_review', priority: 'medium', assignee: arjunId, deadline: daysFromNow(3) },
    { project: mobileProject.insertId, name: 'Integrate crash reporting', status: 'in_progress', priority: 'high', assignee: rheaId, deadline: daysFromNow(1) },
    { project: mobileProject.insertId, name: 'App Store screenshots', status: 'in_progress', priority: 'low', assignee: arjunId, deadline: daysFromNow(6) },
    { project: mobileProject.insertId, name: 'Beta tester feedback triage', status: 'todo', priority: 'medium', assignee: rheaId, deadline: daysFromNow(-3) },
    { project: mobileProject.insertId, name: 'Write release notes', status: 'todo', priority: 'low', assignee: null, deadline: daysFromNow(12) },
  ];

  for (const t of tasks) {
    const [result] = await db.query(
      `INSERT INTO tasks (name, description, project_id, assignee_id, priority, deadline, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [t.name, '', t.project, t.assignee, t.priority, t.deadline, t.status, demoUserId]
    );

    await db.query(
      'INSERT INTO audit_logs (workspace_id, user_id, task_id, action) VALUES (?, ?, ?, ?)',
      [workspaceId, demoUserId, result.insertId, `Created task "${t.name}"`]
    );
  }

  console.log('Demo data created.');
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
