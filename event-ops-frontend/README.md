# Event Ops Frontend

> Next.js 16 (App Router) · React 19 · TypeScript

The dashboard for the Intelligent Event Operations & Task Management System: events, a draggable
task **timeline** and a sortable **list view**, real-time notifications + presence, custom progress
statuses, task links, and an AI command drawer. Bilingual (EN / Tiếng Việt). Runs on **port 3001**
and talks to the backend API on **port 3000**.

> The repo root [`README.md`](../README.md) is the authoritative setup guide (prerequisites, DB,
> accounts, sharing, deployment). This file covers the frontend layout only.

## Run locally

The backend (and its database) must be up first — the app calls the API on boot.

```bash
npm install --legacy-peer-deps
npm run dev -- --port 3001     # http://localhost:3001
```

`npm run dev` bumps the Node heap (`--max-old-space-size`) for large builds. Other scripts:
`npm run build`, `npm start` (production), `npm run lint`, and `npm run share:web` (ngrok tunnel with
real-time — see the root README's "Sharing Online" section).

## Project layout (`src/`)

```
app/                  App Router pages — / (dashboard), /events, /tasks, /users, /login
components/           AppShell, Sidebar, TaskTimeline (Gantt), TaskList (sortable/filterable table),
                      AiDrawer, EventPicker, Modal, Avatar, Toast, IdChip, …
context/              AuthContext (JWT + role flags), LanguageContext (EN/VI)
lib/                  api.ts (axios + endpoint helpers), useSocket/useLiveData/useNotifications,
                      time.ts, timeline.ts (lane packing geometry), roles.ts, filters.ts, types.ts
```

### Key concepts

- **Auth & roles** — `context/AuthContext.tsx` stores the JWT + user and exposes role flags:
  `isManager` (manager/admin — tasks, team, AI), `isAdmin`, `isOrganizer`, `canManageEvents`
  (organizer/admin). The UI hides features a role can't use; the backend enforces the same rules.
- **API** — prefer the `api` axios instance and its grouped helpers (`eventsApi`, `tasksApi`,
  `usersApi`, `aiApi`) in `lib/api.ts`; a request interceptor attaches the JWT on every call.
- **Real-time** — `lib/useSocket.ts` and the hooks on top (`useNotifications`, `useLiveData` for
  `data_changed` refetch, `usePresence`) connect to the Socket.io server and surface live events.
- **Tasks page** (`app/tasks/page.tsx`) — a **List ↔ Timeline** toggle over one fetched data set.
  The timeline (`components/TaskTimeline.tsx`) draws a live "now" line and floors scheduling at now;
  the list (`components/TaskList.tsx`) sorts (priority/deadline/start/name) and filters (status,
  priority, custom progress label, and a staff-only "linked to my tasks"). Both share filter +
  selection state. Custom statuses are managed in a modal and shown as chips; task links are managed
  in a per-task modal. UI guards mirror the hard server-side rules (not-in-past, event-window, undo).

### Next.js 16 / React 19

APIs and conventions can differ from older Next versions. Before changing frontend code, see
[`AGENTS.md`](./AGENTS.md) and the bundled guides under `node_modules/next/dist/docs/`.
