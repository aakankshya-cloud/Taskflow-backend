# TaskFlow API

The backend for **TaskFlow**, a real-time project and task management app (think Trello/Asana). Built with Express and MySQL, with JWT auth, workspace-based role permissions, and live updates over WebSockets.

Pairs with the [TaskFlow frontend](https://github.com/aakankshya-cloud/taskflow-frontend).

## Features

- **Auth** — signup/login with hashed passwords (bcrypt) and JWT sessions
- **Workspaces** — multi-tenant workspaces with role-based access (`admin`, `manager`, `member`)
- **Invites** — invite members by generating single-use join codes
- **Projects & Tasks** — Kanban-style task tracking scoped to a project inside a workspace
- **Comments** — threaded comments on tasks, with permission checks on delete
- **Notifications** — per-user notifications with read/unread state
- **Real-time updates** — Socket.IO pushes task changes live to everyone in a workspace; sockets authenticate with a JWT and are checked against workspace membership before joining a room
- **Analytics & workload** — per-workspace analytics and member workload endpoints
- **Audit log** — tracks key actions taken inside a workspace
- **API docs** — interactive Swagger UI at `/api/docs`, generated from JSDoc comments on the routes
- **Hardened by default** — Helmet, CORS locked to a configured frontend origin, and rate limiting (general API + a stricter limit on `/api/auth`)

## Tech stack

Node.js · Express 5 · MySQL (`mysql2`) · Socket.IO · JWT · bcrypt · Joi (validation) · Helmet · express-rate-limit · Swagger (OpenAPI 3) · Jest + Supertest

## Project structure

```
taskflow-backend/
├── config/          # DB connection
├── controllers/      # Route handlers / business logic
├── db/init.sql        # Schema — run once against an empty database
├── middleware/        # auth, role-based authorize, request validation, workspace access
├── routes/            # Express routers (also carry the @openapi doc comments)
├── tests/              # Jest + Supertest integration tests
├── server.js           # App entry point, Socket.IO setup, security middleware
└── swagger.js           # OpenAPI spec config
```

## Getting started

### Prerequisites
- Node.js 20+
- A MySQL 8 instance (local, Docker, or managed e.g. Aiven/PlanetScale)

### Setup

```bash
git clone https://github.com/aakankshya-cloud/taskflow-backend.git
cd taskflow-backend
npm install
```

Create a `.env` file in the project root:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=taskflow
JWT_SECRET=some_long_random_string
PORT=5000
FRONTEND_URL=http://localhost:5173
```

Load the schema:

```bash
mysql -u root -p taskflow < db/init.sql
```

Run the server:

```bash
npm start
```

The API is now running at `http://localhost:5000`, with interactive docs at `http://localhost:5000/api/docs`.

Optionally seed some demo data:

```bash
npm run seed:demo
```

### Running tests

```bash
npm test
```

Tests run against a real MySQL instance — the CI workflow (`.github/workflows/ci.yml`) spins one up automatically and loads `db/init.sql` before running `npm test`, so you can use that as a reference for a local test DB too.

## API overview

All routes are prefixed with `/api`. Protected routes require an `Authorization: Bearer <token>` header. Full request/response schemas are in the Swagger docs at `/api/docs`.

| Method | Route | Description |
|---|---|---|
| POST | `/auth/signup` | Create an account |
| POST | `/auth/login` | Log in, receive a JWT |
| POST | `/workspaces` | Create a workspace |
| GET | `/workspaces` | List your workspaces |
| POST | `/workspaces/:id/invite` | Generate an invite code (manager/admin) |
| POST | `/workspaces/join` | Join a workspace via invite code |
| GET | `/workspaces/:id/members` | List members |
| PUT | `/workspaces/:id/members/:userId/role` | Change a member's role (admin) |
| DELETE | `/workspaces/:id/members/:userId` | Remove a member (admin) |
| POST | `/workspaces/:id/leave` | Leave a workspace |
| GET | `/workspaces/:id/analytics` | Workspace analytics |
| GET | `/workspaces/:id/workload` | Member workload breakdown |
| GET | `/workspaces/:id/audit-logs` | Audit log for the workspace |
| GET | `/workspaces/:id/search` | Search within a workspace |
| POST | `/projects` | Create a project |
| GET | `/projects/:workspaceId` | List projects in a workspace |
| DELETE | `/projects/:id` | Delete a project |
| POST | `/tasks` | Create a task |
| GET | `/tasks/:projectId` | List tasks in a project |
| PUT | `/tasks/:id` | Update a task |
| PUT | `/tasks/:id/status` | Update a task's status (drag-and-drop) |
| DELETE | `/tasks/:id` | Delete a task |
| GET | `/tasks/:taskId/comments` | List comments on a task |
| POST | `/tasks/:taskId/comments` | Add a comment |
| DELETE | `/tasks/comments/:id` | Delete a comment |
| GET | `/notifications` | List your notifications |
| PUT | `/notifications/:id/read` | Mark one as read |
| PUT | `/notifications/read-all` | Mark all as read |

## Real-time events (Socket.IO)

Clients connect with a JWT in `socket.handshake.auth.token`. To receive live task updates for a workspace, emit:

```js
socket.emit('join:workspace', workspaceId);
```

The server verifies the socket's user is actually a member of that workspace before adding it to the room — anonymous/unauthorized sockets are rejected at the connection level.

## Deployment

A `Dockerfile` is included for containerized deployment:

```bash
docker build -t taskflow-backend .
docker run -p 5000:5000 --env-file .env taskflow-backend
```

CI runs on every push/PR to `main` via GitHub Actions (`.github/workflows/ci.yml`), spinning up MySQL and running the full test suite.

## License

MIT — see [LICENSE](./LICENSE).