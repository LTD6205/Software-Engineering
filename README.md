# Intelligent Event Operations and Task Management System

> A full-stack web platform for event planning companies to manage events, assign tasks to personnel, monitor deadlines in real time, and leverage AI-powered natural language commands to dynamically update workflows.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15+ (React 18, TypeScript, Tailwind CSS) |
| Backend | NestJS v11 (Node.js, TypeScript) |
| Database | PostgreSQL 13 |
| ORM | TypeORM 0.3.20 |
| Authentication | JWT (JSON Web Tokens) + Passport.js |
| Real-time | Socket.io (WebSocket) |
| Job Queue | BullMQ + Redis (Upstash) |
| AI Provider | DeepSeek Chat API |
| Version Control | Git + GitHub |

---

## Project Structure

```
Software_Engineering/
├── event-ops-backend/              ← NestJS REST API + WebSocket + AI
│   ├── src/
│   │   ├── auth/                   ← JWT authentication module
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── jwt.strategy.ts
│   │   │   ├── jwt-auth.guard.ts
│   │   │   ├── roles.guard.ts
│   │   │   └── roles.decorator.ts
│   │   ├── users/                  ← User management (manager only)
│   │   │   ├── users.module.ts
│   │   │   ├── users.service.ts
│   │   │   └── users.controller.ts
│   │   ├── entities/               ← TypeORM entities (10 tables)
│   │   ├── events/                 ← Events CRUD module
│   │   ├── tasks/                  ← Tasks, assignments, milestones
│   │   ├── notifications/          ← Cron job + deadline monitoring
│   │   ├── websocket/              ← Socket.io gateway
│   │   ├── ai/                     ← DeepSeek AI command handler
│   │   ├── app.module.ts           ← Root module
│   │   └── main.ts                 ← Entry point (port 3000)
│   ├── .env                        ← Environment variables (NOT committed)
│   ├── .env.example                ← Template for environment variables
│   ├── event_ops_schema.sql        ← Database schema (run this first)
│   ├── auth_migration.sql          ← Auth migration (run this second)
│   └── package.json
│
└── event-ops-frontend/             ← Next.js dashboard UI
    ├── src/
    │   ├── app/                    ← Pages (Next.js App Router)
    │   │   ├── layout.tsx          ← Root layout with AuthProvider
    │   │   ├── page.tsx            ← Dashboard
    │   │   ├── login/              ← Login page
    │   │   ├── events/             ← Event management
    │   │   ├── tasks/              ← Task management + assignment
    │   │   ├── notifications/      ← Notification center
    │   │   ├── ai/                 ← AI assistant chat
    │   │   └── users/              ← Team management (manager only)
    │   ├── components/             ← Reusable UI components
    │   │   ├── AppShell.tsx        ← Auth guard + layout wrapper
    │   │   ├── Sidebar.tsx         ← Role-aware navigation
    │   │   ├── TopBar.tsx          ← Header with notification bell
    │   │   ├── EventCard.tsx
    │   │   ├── TaskCard.tsx
    │   │   ├── StatCard.tsx
    │   │   ├── Modal.tsx
    │   │   └── StatusBadge.tsx
    │   ├── context/
    │   │   └── AuthContext.tsx     ← Global auth state + JWT storage
    │   └── lib/                    ← API calls, types, hooks
    │       ├── api.ts              ← Axios with JWT interceptor
    │       ├── types.ts
    │       ├── useSocket.ts
    │       └── useNotifications.ts
    ├── .env.local                  ← Frontend environment variables (NOT committed)
    └── package.json
```

---

## Database Schema

The system uses **10 PostgreSQL tables**:

| Table | Purpose |
|---|---|
| `users` | System users with roles (admin, manager, staff) and bcrypt passwords |
| `events` | Events with lifecycle status |
| `tasks` | Task checklists per event with priority and deadlines |
| `task_logs` | Audit trail of every task change |
| `task_assignments` | Many-to-many: users assigned to tasks |
| `task_dependencies` | Task chain dependencies |
| `milestones` | Percentage-based task checkpoints |
| `notifications` | In-app alerts and reminders |
| `ai_requests` | AI prompt and response history |
| `ai_task_map` | Links AI requests to created tasks |

---

## User Roles and Permissions

| Feature | Manager | Staff |
|---|---|---|
| View dashboard | ✅ | ✅ |
| View events | ✅ | ✅ |
| Create / delete events | ✅ | ❌ |
| View all tasks | ✅ | ❌ |
| View assigned tasks only | ✅ | ✅ |
| Create / delete tasks | ✅ | ❌ |
| Update task status | ✅ | ✅ (own tasks) |
| Assign tasks to staff | ✅ | ❌ |
| View own notifications | ✅ | ✅ |
| AI Assistant | ✅ | ❌ |
| Team management | ✅ | ❌ |

---

## Setting Up for a New Team Member

This guide is for someone joining the project for the first time.

### What you need to install first

| Tool | Version | Download |
|---|---|---|
| Node.js | v20.19.0 LTS | nodejs.org — download Windows installer |
| PostgreSQL | v13 | postgresql.org — install with pgAdmin 4 included |
| Git | Latest | git-scm.com |
| VS Code | Latest | code.visualstudio.com |

After installing Node.js, open a terminal and install the NestJS CLI:

```bash
npm install -g @nestjs/cli
```

---

### Step 1 — Clone both repositories

Open PowerShell or Command Prompt and run:

```bash
cd D:\
mkdir Software_Engineering
cd Software_Engineering

git clone https://github.com/your-username/event-ops-backend.git
git clone https://github.com/your-username/event-ops-frontend.git
```

> Replace `your-username` with the actual GitHub username shared by your team lead.

---

### Step 2 — Set up the database

1. Open **pgAdmin 4**
2. Right-click **Databases** → **Create** → **Database** → name it `event_ops` → Save
3. Click on `event_ops` to select it → click the **Query Tool** button (⚡)
4. Open `event_ops_schema.sql` → paste all content → press **F5** to run
5. Open `auth_migration.sql` → paste all content → press **F5** to run

You should see **10 tables** created under `event_ops → Schemas → public → Tables`.

---

### Step 3 — Set up the backend

```bash
cd D:\Software_Engineering\event-ops-backend
npm install --legacy-peer-deps
```

Create your `.env` file by copying the example:

```bash
copy .env.example .env
```

Open `.env` in VS Code and fill in your values:

```
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_postgresql_password_here
DB_NAME=event_ops

REDIS_HOST=localhost
REDIS_PORT=6379

DEEPSEEK_API_KEY=your_deepseek_key_here

JWT_SECRET=eventops_super_secret_jwt_key_2026

PORT=3000
```

> ⚠️ Ask your team lead for the correct JWT_SECRET value. It must match across all team members.

Start the backend:

```bash
npm run start:dev
```

Wait until you see:

```
Nest application successfully started
Backend running on http://localhost:3000/api
```

---

### Step 4 — Set up the frontend

```bash
cd D:\Software_Engineering\event-ops-frontend
npm install --legacy-peer-deps
```

Create a `.env.local` file in the root of the frontend folder (same level as `package.json`):

```
NEXT_PUBLIC_API_URL=http://localhost:3000/api
NEXT_PUBLIC_WS_URL=http://localhost:3000
```

Start the frontend:

```bash
npm run dev -- --port 3001
```

Wait until you see:

```
✓ Ready
```

---

### Step 5 — Open the app

Go to `http://localhost:3001` in your browser.

Log in with the default manager account:

| Field | Value |
|---|---|
| Email | manager@eventops.com |
| Password | password |

The manager can then create your personal staff account from the **Team** page (sidebar → Team → Add Member).

---

### Step 6 — Stay up to date with your team

Every time you start working, pull the latest code first:

```bash
cd D:\Software_Engineering\event-ops-backend
git pull

cd D:\Software_Engineering\event-ops-frontend
git pull
```

Then restart both servers.

---

### Files you must create manually (NOT in GitHub for security)

| File | Location | What to do |
|---|---|---|
| `.env` | `event-ops-backend/` | Copy `.env.example` → rename to `.env` → fill in values |
| `.env.local` | `event-ops-frontend/` | Create manually with the two lines shown in Step 4 |

The database also needs to be set up manually on each person's machine by running the two SQL files.

---

## How to Start the System Every Time

Always start in this order — **backend first, frontend second**:

**Terminal 1 — Backend:**
```bash
cd D:\Software_Engineering\event-ops-backend
npm run start:dev
```
Wait for: `Nest application successfully started`

**Terminal 2 — Frontend:**
```bash
cd D:\Software_Engineering\event-ops-frontend
npm run dev -- --port 3001
```
Wait for: `✓ Ready`

Then open: `http://localhost:3001`

---

## How to Stop the System

In each terminal press **Ctrl+C** then type **Y** and press **Enter**.

> ⚠️ Always stop properly with Ctrl+C. Never just close the terminal window — it leaves port 3000 or 3001 occupied and causes an error on next startup.

If you get a port already in use error:
```powershell
netstat -ano | findstr :3000
taskkill /PID <pid_number> /F
```

---

## Daily Workflow

```
Every time you start working:
1. git pull (in both folders)
2. Terminal 1: cd event-ops-backend  → npm run start:dev
3. Terminal 2: cd event-ops-frontend → npm run dev -- --port 3001
4. Open http://localhost:3001

When you finish working:
1. Ctrl+C in both terminals (type Y to confirm each)
2. cd event-ops-backend  → git add . → git commit -m "message" → git push
3. cd event-ops-frontend → git add . → git commit -m "message" → git push
```

---

## API Endpoints

All endpoints require a JWT Bearer token in the Authorization header except `/api/auth/login`.

### Authentication
| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | /api/auth/login | Public | Login, returns JWT token + user info |
| GET | /api/auth/me | All roles | Get current logged-in user |

### Users (Manager only)
| Method | Endpoint | Description |
|---|---|---|
| GET | /api/users | Get all team members |
| POST | /api/users | Create new staff account |
| PUT | /api/users/:id | Update user info or password |
| PUT | /api/users/:id/deactivate | Deactivate user account |

### Events
| Method | Endpoint | Description |
|---|---|---|
| GET | /api/events | Get all events |
| GET | /api/events/:id | Get one event |
| POST | /api/events | Create event |
| PUT | /api/events/:id | Update event |
| DELETE | /api/events/:id | Delete event |

### Tasks
| Method | Endpoint | Description |
|---|---|---|
| GET | /api/tasks/event/:eventId | Get tasks for an event |
| GET | /api/tasks/:id | Get one task |
| POST | /api/tasks | Create task |
| PUT | /api/tasks/:id | Update task |
| POST | /api/tasks/:id/assign | Assign user to task |
| DELETE | /api/tasks/:id/assign/:userId | Unassign user |
| GET | /api/tasks/:id/milestones | Get milestones |
| POST | /api/tasks/:id/milestones | Add milestone |
| PUT | /api/tasks/milestones/:id/complete | Complete milestone |

### Notifications
| Method | Endpoint | Description |
|---|---|---|
| GET | /api/notifications/user/:userId | Get unread notifications |
| PUT | /api/notifications/:id/read | Mark as read |

### AI
| Method | Endpoint | Description |
|---|---|---|
| POST | /api/ai/command | Send natural language command |

**AI command body example:**
```json
{
  "userId": "your-user-uuid",
  "eventId": "your-event-uuid",
  "message": "Create 3 tasks for venue setup by next Friday, high priority"
}
```

---

## Features

### Authentication and Role-Based Access
JWT-based login system. The manager account is created during database setup. Managers can add staff accounts directly from the Team page. Staff see a restricted UI with no create/delete buttons and no access to AI or Team pages. All API routes are protected with JWT guards and role guards.

### Event Management
Create and manage events with full lifecycle tracking (pending, in progress, completed). Each event has a name, description, start and end time.

### Task Management
Build detailed task checklists per event displayed in a Kanban board (Pending, In Progress, Completed, Overdue). Managers assign tasks to specific staff with start time, deadline, and priority. Staff can update the status of their own assigned tasks.

### Real-time Deadline Monitoring
Automated cron job runs every 30 minutes. Tasks due within 24 hours receive reminder notifications. Tasks past their deadline are automatically marked overdue and trigger alert notifications pushed in real time via WebSocket to all assigned users.

### AI Natural Language Commands
Managers type plain English or Vietnamese commands to create tasks automatically. The AI parses the command via DeepSeek API and returns structured task data which the system saves directly to the database. Every request and response is saved for auditing.

### Notification Center
Live notification bell in the top bar shows unread count. The notifications page lists all alerts with time indicators (reminder, alert, overdue) and allows marking them as read.

### Team Management
Managers can add staff accounts (name, email, password, role), view all team members, and activate or deactivate accounts.

---

## Environment Variables Reference

### Backend (`.env`)
| Variable | Description |
|---|---|
| DB_HOST | PostgreSQL host (localhost) |
| DB_PORT | PostgreSQL port (5432 for PostgreSQL 13) |
| DB_USERNAME | PostgreSQL username (postgres) |
| DB_PASSWORD | Your PostgreSQL password |
| DB_NAME | Database name (event_ops) |
| REDIS_HOST | Redis host (localhost or Upstash URL) |
| REDIS_PORT | Redis port (6379) |
| DEEPSEEK_API_KEY | DeepSeek API key from platform.deepseek.com |
| JWT_SECRET | Secret key for signing JWT tokens (keep this consistent across team) |
| PORT | Backend port (3000) |

### Frontend (`.env.local`)
| Variable | Description |
|---|---|
| NEXT_PUBLIC_API_URL | Backend API URL (http://localhost:3000/api) |
| NEXT_PUBLIC_WS_URL | WebSocket URL (http://localhost:3000) |

---

## Package Versions (do not upgrade without testing)

### Backend
```
@nestjs/common:   11.x
@nestjs/typeorm:  11.0.0
typeorm:          0.3.20
@nestjs/schedule: 4.1.0
@nestjs/jwt:      latest
@nestjs/passport: latest
bcrypt:           latest
```

### Frontend
```
next:             15+
react:            18+
axios:            1.x
socket.io-client: 4.x
```

---

## Known Issues and Fixes Applied

| Issue | Fix Applied |
|---|---|
| TypeORM incompatible with NestJS 11 | Pinned typeorm@0.3.20 + @nestjs/typeorm@11.0.0 |
| ScheduleModule incompatible with NestJS 11 | Pinned @nestjs/schedule@4.1.0 |
| WebSocket server not initialized error | Added ! assertion to server property in gateway |
| Node.js crash on Windows (Turbopack) | Added --no-turbo flag to dev script |
| Node.js version instability | Upgraded to Node.js v20.19.0 LTS |
| tsconfig baseUrl deprecated warning | Warning is harmless, left as is |
| PostgreSQL database not found | Updated .env port and credentials to match PostgreSQL 13 |
| @/ path alias not resolving | Added paths config to tsconfig.json |
| components/ and lib/ in wrong folder | Moved both folders into src/ |
| Invalid Date sent to database | Added conditional ISO conversion before API call |
| JWT token not attached to API requests | Added axios interceptor in api.ts |
| npm peer dependency conflicts | Added --legacy-peer-deps flag to all installs |

---

## Architecture

This system uses an **Agile-influenced Layered Modular architecture**:

- **Layer 1 — Frontend (Next.js, port 3001):** Dark-themed dashboard with bilingual EN/VI labels, JWT auth context, role-aware sidebar, real-time notification bell, AI chat interface.
- **Layer 2 — Backend API (NestJS, port 3000):** REST endpoints with JWT guards and role guards, WebSocket gateway, cron scheduler, AI command handler. Organized into independent feature modules.
- **Layer 3 — Database (PostgreSQL 13, port 5432):** 10-table relational schema with UUID primary keys, bcrypt password hashing, JSONB columns, CHECK constraints, and performance indexes.
- **External — DeepSeek AI API:** Natural language processing via HTTPS.
- **External — Redis (Upstash):** Job queue for BullMQ background jobs.

---

## Development Roadmap

### Version 1.0 (Current) ✅
- [x] PostgreSQL schema (10 tables)
- [x] NestJS backend with all modules
- [x] JWT authentication + role-based access control
- [x] Manager and staff user roles
- [x] Next.js frontend with dark theme
- [x] Event and task management with assignment
- [x] Real-time notifications via WebSocket
- [x] Cron-based deadline monitoring
- [x] AI natural language task creation
- [x] Bilingual EN/VI interface
- [x] Team management page

### Version 2.0 (Planned)
- [ ] Email notifications (in addition to in-app)
- [ ] Mobile responsive UI
- [ ] Language toggle (EN/VI)
- [ ] Production cloud deployment
- [ ] Password change from UI
- [ ] Task comments and file attachments
- [ ] Full calendar view with FullCalendar

---

## Contributing

```bash
# Always pull latest before starting work
git pull

# Create a new branch for your feature
git checkout -b feature/your-feature-name

# Make your changes, then stage and commit
git add .
git commit -m "Add: description of what you changed"

# Push your branch and open a Pull Request on GitHub
git push origin feature/your-feature-name
```

---

## License

This project is for academic and internal business use only.