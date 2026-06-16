# Event Ops Backend

> NestJS 11 · TypeORM 0.3 · PostgreSQL 16 · Socket.io · any OpenAI-compatible AI (DeepSeek by default)

REST API + Socket.io gateway + per-minute cron scheduler + natural-language AI handler for the
Intelligent Event Operations & Task Management System. Listens on **port 3000**, all routes under the
global prefix **`/api`**.

> The repo root [`README.md`](../README.md) is the authoritative setup + roles + endpoint reference.
> This file covers backend-specific structure and operations. `CLAUDE.md` (root) documents the
> architecture for contributors in depth.

---

## Architecture

A modular monolith: each feature module follows **controller → service → TypeORM repository**.

- **auth** — JWT + Passport. `JwtAuthGuard` validates the bearer token; `RolesGuard` + `@Roles(...)`
  enforce **exact-match** access (no inheritance; `admin` is the only cross-role superuser). The
  user is re-loaded from the DB each request, so a deactivated account or changed role takes effect
  immediately.
- **users** — accounts, the staff↔manager reassignment workflow, and join requests.
- **events** — events + the **event-membership policy** (`canManageEvent` / `canViewEvent`) that gates
  *which* event a task action may touch. `TasksService` and `AiService` call it before every
  read/write, so a route's `@Roles` is not sufficient on its own.
- **tasks** — task CRUD, assignments (incl. **manager self-assign**), groups (merge/ungroup),
  **custom progress statuses**, **task links** (symmetric "related" relationship), batch ops, and the
  3-per-event **undo** change-log. Hard rules enforced here: not-in-past scheduling and the
  event-window bound.
- **notifications** — a `@Cron(EVERY_MINUTE)` job flags overdue tasks (bumping `auto`-priority ones to
  High) and pushes notification rows live via the gateway.
- **websocket** — Socket.io gateway. Clients `register` with a JWT in the handshake; the gateway
  verifies it and joins `user:<id>` + an `authenticated` room. Per-user `notification` events and
  `data_changed` / `celebrate` broadcasts flow from here.
- **ai** (modular) — `ai.service` orchestrates; `ai.catalog` / `ai.authz` / `ai.prompt` /
  `ai.validate` / `ai.resolve` / `ai.parse` / `ai.time` / `ai.types` are mostly pure helpers. Calls an
  **OpenAI-compatible** chat endpoint and returns a JSON array of role-gated actions, run in
  auto-accept or ask-first mode. All task changes go through `TasksService`, so the same rules apply.

### Entities (`src/entities/`, 12)

`User`, `Event`, `Task`, `TaskGroup`, `TaskAssignment`, `TaskLog` (audit), `TaskChangeLog` (undo),
`TaskCustomStatus`, `TaskDependency` (task links), `Notification`, `AiRequest`, `AiTaskMap`.

Entity property names match the `snake_case` columns. UUID PKs, CHECK constraints, and JSONB columns
live in the SQL, **not** the entities (`synchronize: false`).

---

## Commands

Run from `event-ops-backend/`. `npm install` may need `--legacy-peer-deps`.

| Command | What it does |
|---|---|
| `npm run start:dev` | Dev server with watch (http://localhost:3000/api) |
| `npm run build` / `npm run start:prod` | Compile to `dist/` and run |
| `npm run lint` / `npm run format` | ESLint `--fix` / Prettier |
| `npm test` | Jest unit specs (`*.spec.ts` under `src/`) |
| `npm test -- tasks.service` | Run specs matching a filter |
| `npm run test:e2e` | E2E specs (`test/`, needs a running seeded DB) |
| `npm run db:migrate` | Apply ordered, idempotent `migrations/*.sql` |
| `npm run db:backup` / `npm run db:restore` | pg_dump / restore to `backups/` |
| `npm run seed` | Create the demo login accounts (idempotent) |

**Tests** construct each service directly with hand-rolled mock repositories (`jest.fn()` for
`find`/`save`/`findOne`/`manager.query`, passed `as never`) — no Nest DI container. The event-access
policy is mocked to "allow" in `TasksService` specs and unit-tested in its own spec; the e2e suite
boots the real app against a seeded test Postgres.

---

## Database

- PostgreSQL 16 via Docker (`docker-compose.yml`, container `event_ops_db`, db `event_ops`).
- **`synchronize: false`** — the schema is **not** derived from entities. The canonical DDL is
  `../database_creating.txt` (repo root); apply it, then `npm run db:migrate` layers the ordered
  `migrations/*.sql` on top. Keep the DDL, migrations, and `src/entities/` in sync **by hand**.
- **Status vocab differs by table**: a **task** is `in_progress` → `completed`, with the cron flipping
  it to `overdue` (there is no `pending` task stage — dropped by migration; the value lingers in the
  CHECK only for legacy rows). An **event**'s `status` still uses `pending`.
- **Priority**: `tasks.priority_source ∈ user|ai|auto`. `auto` derives Low/Med/High from the task's
  position in the event window (bumped to High when overdue); `user`/`ai` are pinned.

---

## API surface

All routes under `/api`, JWT required except `POST /auth/login`. See the root README for the full
access table. Highlights:

- **Tasks** — `GET /tasks/event/:eventId` (staff see assigned **+ linked** tasks), `GET /tasks/:id`
  (+ `/assignments`, `/links`), `PUT /tasks/:id` (status / `custom_status_id` by creator or assignee),
  `POST /tasks`, `DELETE /tasks/:id`, `PUT /tasks/:id/assignments` (managers may self-assign), groups
  (`/groups/merge`, `…/:groupId/add`, `PUT …/:groupId`, ungroup), batch (`/batch/delete`,
  `/batch/ungroup`), undo (`GET …/changes`, `POST …/undo`), **custom statuses**
  (`GET/POST /tasks/event/:eventId/custom-statuses`, `DELETE /tasks/custom-statuses/:id`), **links**
  (`GET/POST /tasks/:id/links`, `DELETE /tasks/:id/links/:targetId`).
- **AI** — `POST /ai/command`, `POST /ai/command/:requestId/confirm`, `…/cancel` (organizer / manager /
  admin). The actor comes from the **verified JWT** — any body `userId` is ignored. Body:

  ```json
  { "eventId": "uuid (optional)", "message": "Mark venue setup as Blocked and link it to catering",
    "mode": "auto", "history": [] }
  ```

---

## WebSocket & cron

- **Socket.io** shares port 3000. Clients emit `register` with the JWT in the handshake auth; the
  gateway verifies it (user id from the verified `sub`, never trusted from the client). Per-user
  `notification` events go to `user:<id>`; `data_changed` / presence / `celebrate` broadcasts go to
  the `authenticated` room.
- **Cron** (`src/notifications/notifications.service.ts`) runs every minute: marks past-deadline tasks
  `overdue`, bumps `auto`-priority overdue tasks to High, and creates + pushes notification rows.

---

## Environment (`.env`)

Defaults match `docker-compose.yml`.

```
DB_HOST=localhost  DB_PORT=5432  DB_USERNAME=postgres  DB_PASSWORD=postgres  DB_NAME=event_ops
JWT_SECRET=dev_local_secret_change_me
PORT=3000
CORS_ORIGIN=http://localhost:3001       # comma-separated; gates HTTP + Socket.io
FRONTEND_ORIGIN=http://localhost:3001
AI_API_KEY=                              # blank disables the assistant (DEEPSEEK_API_KEY also accepted)
AI_BASE_URL=https://api.deepseek.com/v1  # any OpenAI-compatible endpoint
AI_MODEL=deepseek-chat
# AI_JSON_MODE=off                       # set if your provider rejects strict response_format
```

> `.env` is git-ignored. The values above are **local-dev defaults only** — see the checklist below.

---

## Production deployment checklist ⚠️

Do **not** carry local/demo defaults into a shared deployment:

- [ ] **`JWT_SECRET`** — set a long random value (a missing secret is a hard start-up failure in prod).
- [ ] **`NODE_ENV=production`** — enables the JWT hard-fail and disables dev conveniences.
- [ ] **`CORS_ORIGIN` / `FRONTEND_ORIGIN`** — set to the real frontend origin(s); CORS (HTTP + the
      Socket.io gateway) is locked to these, defaulting to `http://localhost:3001` only for local dev.
- [ ] **Database credentials** — replace `postgres/postgres` with a strong, least-privilege role.
- [ ] **Don't expose Postgres publicly** — drop the host port mapping in production / keep the DB on a
      private network.
- [ ] **Demo accounts** — `seed.js` loads well-known logins; don't seed them in production (or rotate
      every password immediately).
- [ ] **`AI_API_KEY`** — use a production key with its own quota; rotate any key ever committed.

For the full EC2 stack (Postgres + API + web + nginx) see [`../DEPLOY.md`](../DEPLOY.md).
