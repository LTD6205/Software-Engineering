# Intelligent Event Operations and Task Management System

> A full-stack web platform for event planning companies to manage events, assign tasks, monitor deadlines in real time, and leverage AI-powered natural language commands to dynamically update workflows.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15+ (React 18, TypeScript, Tailwind CSS) |
| Backend | NestJS v11 (Node.js, TypeScript) |
| Database | PostgreSQL 13 |
| ORM | TypeORM 0.3.20 |
| Real-time | Socket.io (WebSocket) |
| Job Queue | BullMQ + Redis (Upstash) |
| AI Provider | DeepSeek Chat API |
| Version Control | Git + GitHub |

---

## Project Structure

```
Software_Engineering/
├── event-ops-backend/         ← NestJS REST API + WebSocket + AI
│   ├── src/
│   │   ├── entities/          ← TypeORM entities (10 tables)
│   │   ├── events/            ← Events CRUD module
│   │   ├── tasks/             ← Tasks, assignments, milestones
│   │   ├── notifications/     ← Cron job + deadline monitoring
│   │   ├── websocket/         ← Socket.io gateway
│   │   ├── ai/                ← DeepSeek AI command handler
│   │   ├── app.module.ts      ← Root module
│   │   └── main.ts            ← Entry point (port 3000)
│   ├── .env                   ← Environment variables (not committed)
│   ├── .env.example           ← Template for environment variables
│   └── package.json
│
└── event-ops-frontend/        ← Next.js dashboard UI
    ├── src/
    │   ├── app/               ← Pages (App Router)
    │   │   ├── page.tsx       ← Dashboard
    │   │   ├── events/        ← Event management
    │   │   ├── tasks/         ← Task management
    │   │   ├── notifications/ ← Notification center
    │   │   └── ai/            ← AI assistant chat
    │   ├── components/        ← Reusable UI components
    │   │   ├── Sidebar.tsx
    │   │   ├── TopBar.tsx
    │   │   ├── EventCard.tsx
    │   │   ├── TaskCard.tsx
    │   │   ├── StatCard.tsx
    │   │   ├── Modal.tsx
    │   │   └── StatusBadge.tsx
    │   └── lib/               ← API calls, types, hooks
    │       ├── api.ts
    │       ├── types.ts
    │       ├── useSocket.ts
    │       └── useNotifications.ts
    ├── .env.local             ← Frontend environment variables
    └── package.json
```

---

## Database Schema

The system uses **10 PostgreSQL tables**:

| Table | Purpose |
|---|---|
| `users` | System users (admin, manager, staff) |
| `events` | Events with lifecycle status |
| `tasks` | Task checklists per event |
| `task_logs` | Audit trail of every task change |
| `task_assignments` | Many-to-many: users assigned to tasks |
| `task_dependencies` | Task chain dependencies |
| `milestones` | Percentage-based task checkpoints |
| `notifications` | In-app alerts and reminders |
| `ai_requests` | AI prompt and response history |
| `ai_task_map` | Links AI requests to created tasks |

---

## Getting Started

### Prerequisites

| Tool | Version | Download |
|---|---|---|
| Node.js | v20.19.0 LTS or higher | nodejs.org |
| PostgreSQL | v13 or higher | postgresql.org |
| Git | Latest | git-scm.com |

### 1. Clone the repository

```bash
git clone https://github.com/your-username/event-ops-backend.git
cd event-ops-backend
```

### 2. Set up the database

- Open pgAdmin 4
- Create a database called `event_ops`
- Open the Query Tool and run the full schema:

```bash
# Run the schema file in pgAdmin Query Tool
event_ops_schema.sql
```

### 3. Set up the backend

```bash
cd event-ops-backend
npm install
```

Copy the environment template and fill in your values:

```bash
copy .env.example .env
```

Edit `.env`:

```
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_postgresql_password
DB_NAME=event_ops

REDIS_HOST=localhost
REDIS_PORT=6379

DEEPSEEK_API_KEY=your_deepseek_api_key

PORT=3000
```

Start the backend:

```bash
npm run start:dev
```

You should see:
```
Nest application successfully started
Backend running on http://localhost:3000/api
```

### 4. Set up the frontend

```bash
cd event-ops-frontend
npm install
```

Create `.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:3000/api
NEXT_PUBLIC_WS_URL=http://localhost:3000
```

Start the frontend:

```bash
npm run dev -- --port 3001
```

Open your browser at `http://localhost:3001`

---

## How to Start the System Every Time

Always start in this order:

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

## How to Stop the System

In each terminal press `Ctrl+C` then type `Y` and press `Enter`.

> ⚠️ Always stop properly with Ctrl+C. Never just close the terminal — it leaves port 3000 or 3001 occupied and causes errors on next startup.

If you get a port already in use error:
```powershell
netstat -ano | findstr :3000
taskkill /PID <pid_number> /F
```

---

## API Endpoints

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

**AI command example:**
```json
{
  "userId": "your-user-uuid",
  "eventId": "your-event-uuid",
  "message": "Create 3 tasks for venue setup by next Friday, high priority"
}
```

---

## Features

### Event Management
Create and manage events with full lifecycle tracking. Each event has a name, description, start and end time, and status (pending, in progress, completed).

### Task Management
Build detailed task checklists per event. Assign tasks to specific staff members, set priorities (low, medium, high), deadlines, and dependencies between tasks. Tasks are displayed in a Kanban-style board grouped by status.

### Real-time Deadline Monitoring
An automated cron job runs every 30 minutes and checks for tasks approaching their deadline (within 24 hours) or already overdue. Notifications are pushed in real time to assigned users via WebSocket and stored in the database.

### AI Natural Language Commands
Managers can type plain English or Vietnamese commands to create or update tasks automatically. The AI parses the command and returns a structured JSON action plan which the system executes. Every AI request and response is saved for auditing.

### Notification Center
A notification bell in the top bar shows live unread counts. The notifications page lists all alerts with type indicators (reminder, alert, overdue) and allows marking them as read.

---

## Environment Variables Reference

### Backend (`.env`)
| Variable | Description |
|---|---|
| DB_HOST | PostgreSQL host (localhost) |
| DB_PORT | PostgreSQL port (5432) |
| DB_USERNAME | PostgreSQL username (postgres) |
| DB_PASSWORD | PostgreSQL password |
| DB_NAME | Database name (event_ops) |
| REDIS_HOST | Redis host |
| REDIS_PORT | Redis port (6379) |
| DEEPSEEK_API_KEY | DeepSeek API key from platform.deepseek.com |
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
```

### Frontend
```
next:     15+
react:    18+
axios:    1.x
socket.io-client: 4.x
```

---

## Known Issues and Fixes

| Issue | Fix Applied |
|---|---|
| TypeORM incompatible with NestJS 11 | Pinned typeorm@0.3.20 + @nestjs/typeorm@11.0.0 |
| ScheduleModule incompatible | Pinned @nestjs/schedule@4.1.0 |
| WebSocket server not initialized | Added ! assertion to server property in gateway |
| Node.js crash on Windows (Turbopack) | Added --no-turbo flag to dev script |
| Node.js version instability | Upgraded to Node.js v20.19.0 LTS |
| tsconfig baseUrl deprecated warning | Removed ignoreDeprecations — warning is harmless |
| PostgreSQL not found | Updated .env port and credentials to match PostgreSQL 13 |
| @/ path alias not resolving | Added paths config to tsconfig.json |
| Components in wrong folder | Moved components/ and lib/ into src/ |

---

## Architecture

This system uses an **Agile-influenced Layered Modular architecture**:

- **Layer 1 — Frontend (Next.js, port 3001):** Dashboard UI with dark theme, bilingual EN/VI labels, real-time notification bell, AI chat interface.
- **Layer 2 — Backend API (NestJS, port 3000):** REST endpoints, WebSocket gateway, cron scheduler, AI command handler. Organized into independent feature modules.
- **Layer 3 — Database (PostgreSQL 13, port 5432):** 10-table relational schema with UUID keys, JSONB columns, CHECK constraints, and performance indexes.
- **External — DeepSeek AI API:** Natural language processing via HTTPS.
- **External — Redis (Upstash):** Job queue for BullMQ background jobs.

---

## Development Roadmap

### Version 1.0 (Current)
- [x] PostgreSQL schema (10 tables)
- [x] NestJS backend with all modules
- [x] Next.js frontend with dark theme
- [x] Event and task management
- [x] Real-time notifications via WebSocket
- [x] Cron-based deadline monitoring
- [x] AI natural language task creation
- [x] Bilingual EN/VI interface

### Version 2.0 (Planned)
- [ ] JWT authentication and login page
- [ ] Role-based access control (RBAC) at API level
- [ ] Email notifications (in addition to in-app)
- [ ] Mobile responsive UI
- [ ] Language toggle (EN/VI)
- [ ] User self-registration and password reset
- [ ] Production deployment (cloud)
- [ ] Full calendar view with FullCalendar integration

---

## Contributing

1. Clone the repository
2. Create a new branch: `git checkout -b feature/your-feature-name`
3. Make your changes
4. Commit: `git commit -m "Add: description of change"`
5. Push: `git push origin feature/your-feature-name`
6. Open a Pull Request on GitHub

---

## License

This project is for academic and internal business use only.