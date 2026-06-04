# Event Ops Backend — Project README
> Last updated: April 2026
> Built with: NestJS + TypeORM + PostgreSQL + Socket.io + DeepSeek AI

---

## Project Overview

Intelligent Event Operations and Task Management System backend.
Handles event planning, task assignments, deadline monitoring, real-time
notifications, and AI-powered natural language task creation.

---

## Development Model

This system uses two combined architectural patterns:

### 1. Layered (N-Tier) Architecture
The system is split into three clear layers:
- Frontend (Next.js) — what users see and interact with
- Backend API (NestJS) — business logic and rules
- Database (PostgreSQL) — persistent data storage
Each layer only communicates with the layer directly below it.

### 2. Modular Monolith
The backend is one application divided into independent feature modules:
- EventsModule — manage events
- TasksModule — tasks, assignments, dependencies
- NotificationsModule — deadline monitoring, alerts
- WebsocketModule — real-time push notifications
- AiModule — natural language command processing
Each module owns its own controller, service, and data access.
Modules can be extracted into microservices later if the system grows.

---

## Environment

| Tool          | Version / Location                              |
|---------------|-------------------------------------------------|
| OS            | Windows (native, no WSL)                        |
| Node.js       | v20.9.0                                         |
| NestJS        | v11                                             |
| PostgreSQL     | v13, pgAdmin 4, C: drive                        |
| VS Code       | D:\Software_Engineering\event-ops-backend       |
| Redis         | Upstash (cloud, free tier) — not yet configured |
| AI Provider   | DeepSeek API — not yet configured               |

---

## How to Start the Server

Open VS Code terminal and run:
```powershell
cd D:\Software_Engineering\event-ops-backend
npm run start:dev
```
Wait for: `Nest application successfully started`

## How to Stop the Server ⚠️

In the terminal running the server:
1. Press `Ctrl+C`
2. Type `Y` when asked `Terminate batch job (Y/N)?`
3. Press `Enter`

IMPORTANT: Always stop properly with Ctrl+C.
Never just close the terminal window — it leaves port 3000 occupied
and causes an `EADDRINUSE` error on next startup.

If you get EADDRINUSE error, run:
```powershell
netstat -ano | findstr :3000
taskkill /PID <pid_number> /F
```

---

## Folder Structure

```
event-ops-backend/
├── .env                          ← DB + Redis + API keys
└── src/
    ├── main.ts                   ← Entry point, port 3000, prefix /api
    ├── app.module.ts             ← Root module, wires everything
    ├── entities/                 ← One file per DB table (10 total)
    │   ├── user.entity.ts
    │   ├── event.entity.ts
    │   ├── task.entity.ts
    │   ├── task-log.entity.ts
    │   ├── task-assignment.entity.ts
    │   ├── task-dependency.entity.ts
    │   ├── notification.entity.ts
    │   ├── ai-request.entity.ts
    │   └── ai-task-map.entity.ts
    ├── events/                   ← CRUD for events
    │   ├── events.module.ts
    │   ├── events.service.ts
    │   └── events.controller.ts
    ├── tasks/                    ← CRUD, assignments
    │   ├── tasks.module.ts
    │   ├── tasks.service.ts
    │   └── tasks.controller.ts
    ├── notifications/            ← Cron job, deadline watcher
    │   ├── notifications.module.ts
    │   ├── notifications.service.ts
    │   └── notifications.controller.ts
    ├── websocket/                ← Socket.io real-time push
    │   ├── websocket.module.ts
    │   └── events.gateway.ts
    └── ai/                       ← DeepSeek natural language handler
        ├── ai.module.ts
        ├── ai.service.ts
        └── ai.controller.ts
```

---

## Database

- Engine: PostgreSQL 13
- Database name: event_ops
- Managed via: pgAdmin 4
- Tables (9 total):
  users, events, tasks, task_logs, task_assignments,
  task_dependencies, notifications, ai_requests, ai_task_map
- Schema file: event_ops_schema.sql (already applied, synchronize: false)

### Package versions (compatible set — do not upgrade without testing)
```
typeorm:          0.3.20
@nestjs/typeorm:  11.0.0
@nestjs/schedule: 4.1.0
@nestjs/common:   11.x
```

---

## API Endpoints

### Events
| Method | URL                  | Description       |
|--------|----------------------|-------------------|
| GET    | /api/events          | Get all events    |
| GET    | /api/events/:id      | Get one event     |
| POST   | /api/events          | Create event      |
| PUT    | /api/events/:id      | Update event      |
| DELETE | /api/events/:id      | Delete event      |

### Tasks
| Method | URL                                      | Description             |
|--------|------------------------------------------|-------------------------|
| GET    | /api/tasks/event/:eventId                | Get tasks for an event  |
| GET    | /api/tasks/:id                           | Get one task            |
| POST   | /api/tasks                               | Create task             |
| PUT    | /api/tasks/:id                           | Update task             |
| POST   | /api/tasks/:id/assign                    | Assign user to task     |
| DELETE | /api/tasks/:id/assign/:userId            | Unassign user           |

### Notifications
| Method | URL                              | Description             |
|--------|----------------------------------|-------------------------|
| GET    | /api/notifications/user/:userId  | Get unread notifications|
| PUT    | /api/notifications/:id/read      | Mark as read            |

### AI
| Method | URL               | Description                    |
|--------|-------------------|--------------------------------|
| POST   | /api/ai/command   | Send natural language command  |

**AI command body:**
```json
{
  "userId": "uuid",
  "eventId": "uuid",
  "message": "Create 3 tasks for venue setup by next Friday, assign to Bob"
}
```

---

## WebSocket (Socket.io)

- Port: 3000 (same as HTTP)
- Frontend connects and emits: `register` with `{ userId }`
- Server pushes `notification` event to user's room
- Used for real-time deadline alerts and overdue warnings

---

## Cron Job

- Runs every minute automatically
- Checks tasks due within 24 hours → sends `reminder` notification
- Checks tasks past deadline → marks `overdue`, bumps `auto`-priority tasks to High, sends `overdue` notification
- Located in: `src/notifications/notifications.service.ts`

---

## .env Variables

```
DB_HOST=localhost
DB_PORT=5433
DB_USERNAME=postgres
DB_PASSWORD=your_actual_password
DB_NAME=event_ops

REDIS_HOST=localhost
REDIS_PORT=6379

DEEPSEEK_API_KEY=your_key_here

PORT=3000
```

> The values above and everything in `.env.example` / `docker-compose.yml`
> (`postgres/postgres`, the dev JWT placeholder, the seeded demo accounts) are
> **local-development defaults only**. See the checklist below before any
> non-local deployment.

---

## Production deployment checklist ⚠️

The repo ships with convenient local/demo defaults. Do **not** carry them into a
public or shared deployment — work through this list first:

- [ ] **`JWT_SECRET`** — set a long random value. In production a missing secret
      is a hard start-up failure (`src/auth/jwt-secret.ts`); never reuse the dev
      default `eventops_secret_key`.
- [ ] **`NODE_ENV=production`** — enables the JWT hard-fail above and disables
      dev conveniences.
- [ ] **`FRONTEND_ORIGIN`** — set to the real frontend URL. CORS (HTTP + the
      Socket.io gateway) is locked to this origin, defaulting to
      `http://localhost:3001` only for local dev (`src/main.ts`).
- [ ] **Database credentials** — replace `postgres/postgres` with a strong,
      unique password and a least-privilege role.
- [ ] **Don't expose Postgres publicly** — `docker-compose.yml` publishes 5432 on
      the host for local convenience. Remove that port mapping (or bind it to
      `127.0.0.1`) and put the DB on a private network in production.
- [ ] **Demo accounts** — `seed.js` loads known demo logins documented in the
      README. Don't seed them in production, or rotate every password immediately.
- [ ] **`DEEPSEEK_API_KEY`** — use a production key with its own quota; rotate any
      key that was ever committed or shared.

---

## Progress Tracker

### Phase 1 — Database ✅ COMPLETE
- [x] PostgreSQL 13 schema created (10 tables, all constraints + indexes)
- [x] pgAdmin 4 connected and verified

### Phase 2 — Backend ✅ COMPLETE
- [x] NestJS v11 project scaffolded
- [x] All packages installed (compatible versions)
- [x] .env configured and connected to PostgreSQL
- [x] All 9 entity files created
- [x] main.ts and app.module.ts configured
- [x] Events module (CRUD working — tested with Thunder Client ✅)
- [x] Tasks module (CRUD + assignments)
- [x] Notifications module (cron job + WebSocket push)
- [x] WebSocket gateway (Socket.io)
- [x] AI module (DeepSeek integration)

### Phase 3 — Frontend ⬜ NEXT
- [ ] Scaffold Next.js project
- [ ] Scheduler UI (FullCalendar)
- [ ] Task creation panel
- [ ] AI chat button (Copilot-style)
- [ ] Notification bell (real-time)
- [x] Milestone tracker (per-event progress: completed / total tasks)

### Phase 4 — External Services ⬜ PENDING
- [ ] Upstash Redis (for BullMQ job queue)
- [ ] DeepSeek API key (for AI commands)

---

## Known Issues & Fixes Applied

| Issue | Fix |
|---|---|
| TypeORM incompatible with NestJS 11 | Pinned to typeorm@0.3.20 + @nestjs/typeorm@11.0.0 |
| ScheduleModule incompatible | Pinned to @nestjs/schedule@4.1.0 |
| server! not initialized in gateway | Added ! (definite assignment assertion) |
| tsconfig baseUrl warning | Removed ignoreDeprecations — warning is harmless |
| Database not found | Updated .env to match PostgreSQL 13 port and credentials |