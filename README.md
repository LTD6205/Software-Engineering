# Intelligent Event Operations & Task Management System

A full-stack platform for event teams: create events, assign tasks with deadlines, monitor them in real time, and drive workflows with natural-language AI commands. Role-based access (four roles: Admin, Organizer, Manager, Staff), live online presence, and a bilingual (English / Tiếng Việt) UI.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript |
| Backend | NestJS 11, TypeScript |
| Database | PostgreSQL 16 (via Docker), TypeORM 0.3 |
| Auth | JWT + Passport (exact-match RBAC; admin = superuser) |
| Real-time | Socket.io (presence + notifications + live data) |
| AI | Any OpenAI-compatible chat API — DeepSeek by default; the deployed stack uses Gemini |

## Features

- **Events & membership** — organizers create events and add member managers; each chosen manager brings their whole staff team in, and the event shows a live headcount. Visibility is scoped: admins/organizers see all events, managers see events they're a member of, and staff see events their manager is in. Events can be multi-selected for batch delete, and event dates can be shifted (tasks are moved or dropped to fit the new window).
- **Tasks** — managers build per-event task checklists on a draggable **timeline** (Gantt-style) and assign each task to one or many of their own staff; assignees show as avatars and can be re-selected with a click. A new task starts **In Progress** and moves to **Completed**; the cron job auto-flags it **Overdue** once the deadline passes. Tasks can be **merged into groups**, multi-selected for batch delete/ungroup, and every object carries a **copyable short ID** chip.
- **Undo** — the three most recent task changes per event (manual, batch, or AI-driven) are undoable from a button on the timeline or via an AI command.
- **Auto priority** — a task's priority can be pinned manually (`user`), set by the AI (`ai`), or left on **Auto** (`auto`), which derives Low/Medium/High from where the task sits in the event window; an overdue auto-priority task is bumped to High.
- **Staff reassignment & self-service** — a manager can hand one of their staff to another manager (the receiving manager accepts/rejects); staff can also request to join a manager's team (and cancel the request).
- **Real-time deadline monitoring** — a per-minute cron job flags upcoming/overdue tasks and pushes live notifications over WebSocket to assignees and organizers.
- **AI commands** — managers and organizers describe changes in plain English/Vietnamese; the model turns them into real operations — creating/updating/assigning/grouping/deleting tasks, undo, and (role permitting) event and account changes. Runs in **Auto-accept** or **Ask-first** mode (preview, then confirm/cancel). Times are interpreted in Vietnam time (UTC+7). Each account keeps its **own private chat history** (stored per user, so roles never share a transcript).
- **Roles** — Admin, Organizer, Manager, Staff. Features are scoped by each role's focus: **Managers** own a staff team and handle tasks and the AI assistant; **Organizers** create events, manage event membership, and can also drive the AI for event-scoped changes; **Admins** manage accounts. The backend enforces these per route as an **exact-match allow-list** — no role inherits another's access; `admin` is the only cross-role exception (a superuser allowed everywhere). The UI surfaces only the features that belong to each role, and Staff get a limited UI (their own tasks and notifications).
- **Online presence** — the Team page shows who's online, colour-coded by role.
- **Language switch** — EN/VI toggle that translates the whole UI.
- **Responsive layout** — desktop keeps the fixed sidebar; on narrow screens (≤768px) it collapses into a hamburger drawer and the card grids reflow instead of overflowing.
- **Session validation** — on load the app re-checks the stored token against `/auth/me`, so a deactivated account or a changed role takes effect immediately, and a 401 from any call signs the user out.

## Project Structure

```
event-ops-backend/    NestJS API + Socket.io gateway + cron + AI handler  (port 3000, prefix /api)
  src/{auth,users,events,tasks,notifications,websocket,ai,entities}
  src/ai/             modular AI: ai.service + catalog/prompt/resolve/validate/types/parse/time/authz
  migrations/         ordered, idempotent *.sql applied on top of the base schema (npm run db:migrate)
  docker-compose.yml  local PostgreSQL
  seed.js             creates the login accounts (npm run seed)
event-ops-frontend/   Next.js dashboard (port 3001)
  src/{app,components,context,lib}
  share-proxy.js      HTTP+WebSocket proxy for sharing via one tunnel (npm run share)
deploy/               production stack for EC2 (Postgres + API + web + nginx) — docker-compose.prod.yml
database_creating.txt canonical SQL schema (repo root; applied manually / on first DB boot)
```

## Prerequisites

- **Node.js** 20+ (includes npm)
- **Docker Desktop** (runs PostgreSQL — nothing else to install)
- **Git**

## Quick Start

Clone, then set up each project once.

### Windows one-click (optional)

If you're on **Windows** with **Docker Desktop** and **Node.js 20+** installed, you can skip the
manual steps below and use the bundled scripts (in the repo root):

1. **Double-click `setup-once.bat`** — run this once after cloning. It is idempotent (safe to
   re-run) and:
   - checks that Docker and npm are installed,
   - runs `npm install --legacy-peer-deps` in both `event-ops-backend` and `event-ops-frontend`
     (only when `node_modules` is missing),
   - creates `event-ops-backend/.env` and `event-ops-frontend/.env.local` from the `.example` files,
   - starts Postgres, applies `database_creating.txt` (only if the schema isn't there), and
     seeds the login accounts (only if the database is empty).
2. **Double-click `start-all.bat`** — run this each time you want to work. It launches, in order
   and each in its own window: **Docker + Postgres → backend (:3000) → frontend (:3001) → public
   share link (ngrok via :8080)**, waiting for each to be ready before starting the next. If a
   port is already in use it skips that one; if the clone isn't set up yet it tells you to run
   `setup-once.bat` first.

> The public share link needs ngrok configured once: `ngrok config add-authtoken <your-token>`.
> Without it, backend and frontend still run locally; only the share window will complain.
>
> macOS/Linux users: follow the manual steps below (they do the same thing).

### 1. Database (Docker)
```bash
cd event-ops-backend
docker compose up -d                                            # start PostgreSQL
# Apply the canonical schema (lives in the repo root, one level up):
docker exec -i event_ops_db psql -U postgres -d event_ops < ../database_creating.txt
```

### 2. Backend
```bash
cd event-ops-backend
npm install --legacy-peer-deps
copy .env.example .env        # (macOS/Linux: cp .env.example .env) — defaults match docker-compose
npm run db:migrate            # apply schema migrations on top of database_creating.txt (idempotent)
npm run seed                  # create login accounts
npm run start:dev             # http://localhost:3000/api
# Serving the frontend from a non-default origin (tunnel/prod)? Set CORS_ORIGIN
# (comma-separated) and FRONTEND_ORIGIN in .env — both default to http://localhost:3001.
```

### 3. Frontend
```bash
cd event-ops-frontend
npm install --legacy-peer-deps
npm run dev -- --port 3001    # http://localhost:3001
```

Open **http://localhost:3001** and log in.

### Default accounts (from `npm run seed`)

| Role | Email | Password |
|---|---|---|
| Admin | `admin01@eventops.com` | `admin123` |
| Organizer | `organizer01@eventops.com` … `organizer03@` | `organizer123` |
| Manager | `manager01@eventops.com` … `manager03@` | `manager123` |
| Staff | `staff01@eventops.com` … `staff10@` | `staff123` |

> Seeding randomly assigns each staff member to one manager (their owning team).

> Stop everything: `Ctrl+C` in each terminal. Stop the DB with `docker compose stop` (keeps data) or `docker compose down -v` (deletes data — re-run step 1 + `npm run seed` to restore).

### Back up / restore the database
Snapshots are written to `event-ops-backend/backups/` (git-ignored). From `event-ops-backend`:
```bash
npm run db:backup                 # dump to backups/event_ops_<timestamp>.sql
npm run db:restore                # restore the most recent backup
npm run db:restore -- backups/event_ops_20260101-120000.sql   # restore a specific file
```

## Roles & Permissions (Admin · Organizer · Manager · Staff)

The table below is **authoritative**: the backend enforces it with **exact role matching** (`RolesGuard`), so the API and the UI agree. There is **no level hierarchy / no inheritance** between roles — an Organizer is *not* a Manager and cannot call Manager-only endpoints (create tasks, manage staff), and a Manager cannot call Organizer-only endpoints (events/membership). The **only** cross-role rule is that **Admin is the superuser**, permitted on every role-guarded route. Task management belongs to Managers; a Manager **owns a staff team** but only manages its *membership* — assigning tasks, and reassigning or removing their own staff — while **creating or editing an account (name, contact, role) is admin-only**, as are activate/deactivate and password resets. Organizers focus on events and membership. The AI assistant is open to **managers and organizers** (each limited to the actions their role allows) plus admin; AI account actions (`create_user`/`update_user`/`reset_password`) are admin-only too.

| Action | Admin | Organizer | Manager | Staff |
|---|---|---|---|---|
| View dashboard / tasks | ✅ | ✅ | ✅ | ✅ |
| View events | all | all | member events | their team's events |
| View Team presence board | ✅ | ✅ | ✅ | ✅ (read-only) |
| Create/edit/delete events, shift dates, add member managers | ✅ | ✅ | ❌ | ❌ |
| Create tasks, assign, group, batch-delete | ✅ | ❌ | ✅ (own staff) | ❌ |
| Update task status | ✅ | ❌ | ✅ | ✅ (if assigned) |
| Undo recent task changes | ✅ | ❌ | ✅ (own events) | ❌ |
| Reassign or remove own staff (team membership only) | ✅ | ❌ | ✅ (own staff) | ❌ |
| Request to join a manager's team | ❌ | ❌ | ❌ | ✅ |
| AI Assistant | ✅ | ✅ (event-scoped actions) | ✅ (task/group/reassign actions) | ❌ |
| Create / edit accounts (name, contact, role) | ✅ | ❌ | ❌ | ❌ |
| Activate/deactivate accounts, reset passwords | ✅ | ❌ | ❌ | ❌ |
| Create an Admin account | ✅ | ❌ | ❌ | ❌ |

## Sharing Online (ngrok, with real-time)

Next's dev server can't proxy WebSockets, so `share-proxy.js` fronts both servers on one port (8080) and forwards `/api` + `/socket.io` (incl. WebSocket upgrades) to the backend — letting a single tunnel carry everything, including presence and live notifications.

One-time: `ngrok config add-authtoken <your-token>` (treat the token like a password).

With the backend and frontend already running, in a third terminal:
```bash
cd event-ops-frontend
npm run share:web      # starts the proxy + ngrok and prints the public link
```
This starts the proxy **and** ngrok on port 8080 and prints the link to share. (Or run them separately: `npm run share` then `ngrok http 8080` — always tunnel **8080**, never 3001, or real-time won't reach the backend.)

If the link doesn't print (or you cleared the terminal), open the ngrok inspector at **http://localhost:4040** — the public URL is shown there and at its `/api/tunnels` endpoint.

Visitors click "Visit Site" on ngrok's warning page once, then log in. Local use is unchanged — `http://localhost:3001` still works directly (the socket URL auto-detects).

> For a **stable shared demo**, serve a production build instead of the dev server (the dev server recompiles routes on demand, which can time out over a tunnel and cause "Failed to fetch RSC payload" / endless loading):
> ```bash
> cd event-ops-frontend
> npm run build
> npm run start:prod      # production server on port 3001
> npm run share:web       # in another terminal
> ```

## Production Deployment (EC2)

The `deploy/` folder holds a self-contained stack (`docker-compose.prod.yml`): **Postgres + NestJS API + Next.js web + nginx**. Only nginx publishes a port (80); the app, API, and DB stay on the internal Docker network. The canonical schema is applied automatically the first time the data volume is created; migrations are layered on by the backend.

```bash
cd deploy
cp .env.example .env     # set POSTGRES_PASSWORD, JWT_SECRET, PUBLIC_URL, and (optional) AI_* vars
docker compose -f docker-compose.prod.yml up -d --build
```

`PUBLIC_URL` (the browser-facing origin) drives both HTTP and Socket.io CORS. The AI provider is configurable via `AI_BASE_URL` / `AI_MODEL` / `AI_API_KEY` (the stack defaults to Gemini; leave `AI_API_KEY` blank to disable the assistant).

## API Overview

All routes are under `/api` and require a JWT (except `POST /api/auth/login`).

Access is by **exact role match** with Admin as the superuser. Below, "manager+" means **manager or admin**, and "organizer+" means **organizer or admin** — the `+` is only ever Admin (the superuser), never another role. An organizer **cannot** call "manager+" endpoints, and a manager **cannot** call "organizer+" endpoints. (Several read routes are open to any authenticated user but scope their results to the caller, and `PUT /tasks/:id` carries no `@Roles` — the permission is checked inside the service.)

| Area | Endpoints | Access |
|---|---|---|
| Auth | `POST /auth/login`, `GET /auth/me` | public / any |
| Users | `GET /users`, `GET /users/:id`, reassign workflow (`/reassign`, `…/accept`, `…/reject`, `…/cancel`), `POST /users/:id/remove-from-team` | manager+ |
| | `POST /users`, `PUT /users/:id` (create / edit / role / activate / reset password) | admin |
| | `GET /users/directory`, `PUT /users/me` | any (presence board / own profile) |
| | `POST /users/join-request`, `…/cancel` | staff |
| Events | `GET /events` (viewer-scoped), `GET /events/:id`, `GET /events/:id/managers` | any |
| | `GET /events/available-managers`, `POST/PUT/DELETE /events`, `PUT /events/:id/dates`, `POST/DELETE /events/:id/managers` | organizer+ |
| Tasks | `GET /tasks/event/:eventId` (staff see their assigned + linked tasks), `GET /tasks/:id` (+ `/assignments`, `/links`), `PUT /tasks/:id` (status / custom-status by creator or assignee), `GET /tasks/event/:eventId/custom-statuses` | any (scoped) |
| | `POST /tasks`, `DELETE /tasks/:id`, `PUT /tasks/:id/assignments` (managers may self-assign), group ops (`/groups/merge`, `…/:groupId/add`, `PUT …/:groupId`, ungroup), batch (`/batch/delete`, `/batch/ungroup`), undo (`GET …/changes`, `POST …/undo`), custom statuses (`POST /tasks/event/:eventId/custom-statuses`, `DELETE /tasks/custom-statuses/:id`), task links (`POST`/`DELETE /tasks/:id/links`) | manager+ (links: also a task's creator/assignee) |
| Notifications | `GET /notifications/user/:userId` (+ `/all`), `PUT /notifications/:id/read`, `PUT …/read-all` | any (owner-scoped) |
| AI | `POST /ai/command`, `POST /ai/command/:requestId/confirm`, `…/cancel` | organizer, manager, admin |

The Tasks page offers a **List ↔ Timeline** toggle: the list view sorts (by priority/deadline/start/name) and filters (status, priority, custom progress label, and a staff-only "linked to my tasks") over the same data the Gantt timeline draws. **Custom statuses** are reusable per-event progress labels layered on top of the real lifecycle. **Task links** are symmetric "related" relationships; a staffer sees tasks linked to their assigned tasks (read-only). The AI mirrors these for managers/admin via `create_custom_status`, `link_tasks`/`unlink_tasks`, and a `custom_status` field on `update`.

## Environment Variables

**Backend `.env`** (defaults match `docker-compose.yml`):
```
DB_HOST=localhost  DB_PORT=5432  DB_USERNAME=postgres  DB_PASSWORD=postgres  DB_NAME=event_ops
JWT_SECRET=dev_local_secret_change_me
PORT=3000
CORS_ORIGIN=http://localhost:3001     # comma-separated; browser origin(s) allowed for HTTP + Socket.io
FRONTEND_ORIGIN=http://localhost:3001
# AI is optional — leave the key blank to disable the assistant.
AI_API_KEY=                            # (DEEPSEEK_API_KEY is accepted as a fallback)
AI_BASE_URL=https://api.deepseek.com/v1   # any OpenAI-compatible endpoint (Gemini, Groq, OpenRouter…)
AI_MODEL=deepseek-chat
# AI_JSON_MODE=off                     # set if your provider rejects strict response_format
```

**Frontend `.env.local`**:
```
NEXT_PUBLIC_API_URL=/api     # relative, works locally and behind the share proxy
NEXT_PUBLIC_WS_URL=          # leave blank — auto-detected (see src/lib/wsUrl.ts)
```

> `.env` files are git-ignored. Don't commit secrets.

## Contributing

```bash
git checkout -b feature/your-feature
# make changes
git commit -am "Describe your change"
git push origin feature/your-feature   # then open a Pull Request
```

## License

For academic and internal use only.
