# Intelligent Event Operations & Task Management System

A full-stack platform for event teams: create events, assign tasks with deadlines, monitor them in real time, and drive workflows with natural-language AI commands. Role-based access (Admin > Event Manager > Manager > Staff), live online presence, and a bilingual (English / Tiếng Việt) UI.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript |
| Backend | NestJS 11, TypeScript |
| Database | PostgreSQL 16 (via Docker), TypeORM 0.3 |
| Auth | JWT + Passport (role hierarchy) |
| Real-time | Socket.io (presence + notifications) |
| AI | DeepSeek Chat API |

## Features

- **Events & membership** — event managers create events and add member managers; each chosen manager brings their whole staff team in, and the event shows a live headcount. Visibility is scoped: admins/event managers see all events, managers see events they're a member of, and staff see events their manager is in.
- **Tasks** — managers build per-event task checklists (Kanban: Pending / In Progress / Completed / Overdue) and assign each task to one or many of their own staff; assignees show as avatars on the card and can be re-selected with a click.
- **Staff reassignment** — a manager can hand one of their staff to another manager; the receiving manager gets a request and accepts or rejects it.
- **Real-time deadline monitoring** — a cron job flags upcoming/overdue tasks and pushes live notifications over WebSocket.
- **AI commands** — managers describe tasks in plain English/Vietnamese; DeepSeek turns them into real tasks.
- **Roles** — Admin > Event Manager > Manager > Staff, enforced on the API (a higher level inherits everything below it). Staff get a read-only/limited UI.
- **Online presence** — the Team page shows who's online, colour-coded by role.
- **Language switch** — EN/VI toggle that translates the whole UI.

## Project Structure

```
event-ops-backend/    NestJS API + Socket.io gateway + cron + DeepSeek handler  (port 3000, prefix /api)
  src/{auth,users,events,tasks,notifications,websocket,ai,entities}
  database_creating.txt   canonical SQL schema (applied manually)
  docker-compose.yml      local PostgreSQL
  seed.js                 creates the login accounts (npm run seed)
event-ops-frontend/   Next.js dashboard (port 3001)
  src/{app,components,context,lib}
  share-proxy.js          HTTP+WebSocket proxy for sharing via one tunnel (npm run share)
```

## Prerequisites

- **Node.js** 20+ (includes npm)
- **Docker Desktop** (runs PostgreSQL — nothing else to install)
- **Git**

## Quick Start

Clone, then set up each project once.

### 1. Database (Docker)
```bash
cd event-ops-backend
docker compose up -d                                            # start PostgreSQL
docker exec -i event_ops_db psql -U postgres -d event_ops < database_creating.txt   # apply schema
```

### 2. Backend
```bash
cd event-ops-backend
npm install --legacy-peer-deps
copy .env.example .env        # (macOS/Linux: cp .env.example .env) — defaults match docker-compose
npm run seed                  # create login accounts
npm run start:dev             # http://localhost:3000/api
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
| Event Manager | `eventmanager01@eventops.com` … `eventmanager03@` | `eventmanager123` |
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

## Roles & Permissions (Admin > Event Manager > Manager > Staff)

The API guard is level-based: a role can do everything the roles below it can.

| Action | Admin | Event Manager | Manager | Staff |
|---|---|---|---|---|
| View dashboard / tasks | ✅ | ✅ | ✅ | ✅ |
| View events | all | all | member events | their team's events |
| View Team presence board | ✅ | ✅ | ✅ | ✅ (read-only) |
| Create/edit/delete events, add member managers | ✅ | ✅ | ❌ | ❌ |
| Create tasks & assign to staff | ✅ | ✅ | ✅ (own staff) | ❌ |
| Update task status | ✅ | ✅ | ✅ | ✅ (if assigned) |
| Reassign a staff member to another manager | ✅ | ❌ | ✅ (own staff) | ❌ |
| AI Assistant | ✅ | ✅ | ✅ | ❌ |
| Add team members | ✅ | ✅ | ✅ | ❌ |
| Activate/deactivate accounts | ✅ | ❌ | ❌ | ❌ |
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

## API Overview

All routes are under `/api` and require a JWT (except `POST /api/auth/login`).

Access reflects the level-based guard, so "manager+" also admits event managers and admins, and "event manager+" admits admins.

| Area | Endpoints | Access |
|---|---|---|
| Auth | `POST /auth/login`, `GET /auth/me` | public / any |
| Users | `GET /users`, `POST /users`, `PUT /users/:id` | manager+ |
| | `PUT /users/:id/deactivate` | admin only |
| | `GET /users/directory` | any (presence board) |
| | `GET /users/reassign-requests`, `POST /users/:id/reassign`, `…/reassign/accept`, `…/reassign/reject` | manager+ |
| Events | `GET /events` (viewer-scoped), `GET /events/:id` | any |
| | `GET /events/available-managers`, `GET /events/:id/managers`, `POST/PUT/DELETE /events`, `POST/DELETE /events/:id/managers` | event manager+ |
| Tasks | `GET /tasks/event/:eventId` (assignees included), `PUT /tasks/:id` | any |
| | `POST /tasks`, `PUT /tasks/:id/assignments`, assign/unassign, milestones | manager+ |
| Notifications | `GET /notifications/user/:userId`, `PUT /notifications/:id/read` | any |
| AI | `POST /ai/command` | manager+ |

## Environment Variables

**Backend `.env`** (defaults match `docker-compose.yml`):
```
DB_HOST=localhost  DB_PORT=5432  DB_USERNAME=postgres  DB_PASSWORD=postgres  DB_NAME=event_ops
JWT_SECRET=dev_local_secret_change_me
DEEPSEEK_API_KEY=        # optional — leave blank to disable the AI Assistant
PORT=3000
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
