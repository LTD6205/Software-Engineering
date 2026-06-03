# TODO — Event Ops

Working notes on what was added, what's still missing, and dead code to review.
Last updated 2026-06-04 (frontend audit hardening + responsive pass — see below).

## 2026-06-04 — frontend hardening & responsive (audit follow-ups)

Backend audit fixes landed earlier (`a47a0b0`: JWT-derived identity, event-membership
policy, exact-match RBAC, etc.). This pass closes the remaining **frontend** findings:

- **Session validation (audit #18).** `AuthContext` now treats the cached `localStorage`
  user as an optimistic placeholder only — on mount it calls `/auth/me` and refreshes the
  authoritative role/active state, clearing the session if validation fails. `lib/api.ts`
  gained a response interceptor that drops the session and redirects to `/login` on any
  `401` (a `403` is left for the component — it is not a logout).
- **Type drift (audit #23).** `Task.priority_source` now includes `'auto'`; `Notification`
  now includes `event_id` — both match what the backend actually sends.
- **Responsive / mobile (audit #34, desktop preserved).** The fixed 240px sidebar becomes
  an off-canvas drawer below 768px (hamburger top bar + dimming overlay in `AppShell`,
  `mobileOpen`/`onNavigate` on `Sidebar`, media queries in `globals.css`); `main` reclaims
  full width; the event/dashboard/users grids use `minmax(min(Npx,100%),1fr)` so cards
  reflow instead of forcing a horizontal scrollbar. Desktop layout is unchanged.
- **Build (audit #33).** Frontend deps are installed; `next build` verified green.

Not done (out of scope): #35 touch interactions on the Gantt timeline (right-click/drag/
wheel-zoom have no touch equivalents — a behavioral rebuild, not layout); #19 single-socket
provider; the backend refactors (#13 transactions, #16 global ValidationPipe/DTO layer).

## Testing

Four layers, all green:

| Layer | Where | Run | Count |
|---|---|---|---|
| Backend unit (mocked) | `event-ops-backend/src/**/*.spec.ts` | `npm test` | 10 suites / **120** |
| Backend e2e + integration (real Postgres) | `event-ops-backend/test/*.e2e-spec.ts` | `npm run test:e2e` | 5 suites / **48** |
| Frontend unit + RTL (jsdom) | `event-ops-frontend/src/**/*.test.ts(x)` | `npm test` | 3 suites / **21** |
| Frontend Playwright (browser) | `event-ops-frontend/e2e/*.spec.ts` | `npm run test:e2e` | **6** |

### Backend unit tests (no DB)

Jest unit specs for the core backend logic. **Run from `event-ops-backend/`:**
`npm test` (all), `npm run test:cov` (coverage), or `npm test -- roles.guard`
(single suite by name filter). Default Nest Jest config (`rootDir: src`,
`testRegex: .*\.spec\.ts$`).

All are **pure unit tests** — every repository, the JWT service, the WebSocket
gateway, bcrypt and axios are mocked, so **no database or running server is
needed** and they don't touch the user's dev backend on port 3000.

**Result: 10 suites, 120 tests, all passing (~4 s).**

| Spec file | Tests | What it covers |
|---|---|---|
| `auth/roles.guard.spec.ts` | 10 | The `ROLE_LEVELS` hierarchy: no-`@Roles` passes any authed user; `@Roles('manager')` admits manager/eventmanager/admin but rejects staff; **minimum** level is used across multiple listed roles; unknown role / no user → `ForbiddenException`. |
| `auth/auth.service.spec.ts` | 6 | `validateUser` (active-only lookup, wrong password, missing hash, no user → `Unauthorized`); `login` returns a signed token + sanitized user (no `password_hash`) and propagates auth failures without signing. |
| `tasks/tasks.service.spec.ts` | 11 | `create` validation (name/event required, deadline-after-start, default `in_progress`/`auto`); `recomputeAutoPriorities` thirds bucketing high/medium/low and **not** overwriting `user`/`ai` priorities; assignment rules (staff-only, manager's-own-staff, missing user); status-change permission (non-creator/non-assignee blocked, only creator reopens); `merge` guards (self, cross-event). |
| `notifications/notifications.service.spec.ts` | 8 | `notifyUser` saves + sockets, skips blank id; `notifyUsers` de-dupes & drops blanks/null; `markRead` is user-scoped; `getAll` capped at 50 newest-first; `checkDeadlines` cron marks overdue + alerts, and suppresses a duplicate when an unread alert already exists. |
| `events/events.service.spec.ts` | 7 | `create` validation + member notify; `findOne` not-found; `update`/`updateDates` date-range guard; `updateDates` **shift** strategy moves task times by the start delta and drops tasks landing past the new end. |
| `ai/ai.service.spec.ts` | 5 | `processCommand`: creates a task per array item (priority→score mapping, `priority_source: 'ai'`); assigns when a named user resolves; non-array reply → structured **rejected** (no tasks); invalid JSON → `BadRequest` + request marked rejected; invalid deadline string is dropped (no "Invalid Date" persisted). |
| `users/users.service.spec.ts` | 17 | The staff→manager **reassignment** flow (request/accept/reject/cancel) + all NotFound/Forbidden/BadRequest guards. |
| `users/users.service.crud.spec.ts` | 26 | The rest of `users.service`: `updateProfile` (current-password check, email/phone validation, email-conflict, password hashing), `create` (required fields, dup email, default role, hashing, returns via findOne), `update`, `deactivate`, `findAll` (admin-only `is_active`), `directory`. |
| `tasks/tasks.service.groups.spec.ts` | 20 | Task **groups**: `merge` happy paths (new group / join existing / dissolve old), `addToGroup`, `ungroup`, `renameGroup` (255-char truncate), `dissolveIfTooSmall` (count<2 deletes); `assignUser` notify; `setAssignees` add/remove diff + dedupe; assigned-staff forward-only status rules via `update`. |
| `app.controller.spec.ts` | 1 | Root health (now actually wired — see fix below). |

**Coverage** (`npm run test:cov`, statements): `roles.guard` 100%, `ai.service` 100%,
`auth.service` 95%, `notifications.service` 90%, `users.service` ~90%, `events.service` 63%
(rest covered by e2e), `tasks.service` ~70%.

> **Bug fixed during this work:** `AppController`/`AppService` were **defined but never
> registered** in `app.module.ts` (no `controllers`/`providers` keys), so the documented
> "root health" route 404'd and the scaffold `app.e2e-spec.ts` failed. Re-registered them
> in `AppModule` — the root route works again and the e2e scaffold passes.

### Backend e2e + integration tests (real Postgres)

Added 2026-06-03. **Run from `event-ops-backend/`:** `npm run test:e2e`. These boot the
full Nest app (global `/api` prefix, JWT, guards, cron, WS) via supertest and hit a
**dedicated `event_ops_test` database** — never the developer's `event_ops` data.

**Test-DB setup (one-time, recreate anytime):**
```
# schema cloned from the live DB (keeps entities in sync without the stale DDL file)
docker exec event_ops_db psql -U postgres -c "DROP DATABASE IF EXISTS event_ops_test;"
docker exec event_ops_db psql -U postgres -c "CREATE DATABASE event_ops_test;"
docker exec event_ops_db sh -c "pg_dump -U postgres -s event_ops | psql -U postgres -d event_ops_test"
# seed the known login accounts into it
cd event-ops-backend && DB_NAME=event_ops_test node seed.js   # (PowerShell: $env:DB_NAME='event_ops_test'; node seed.js)
```
`test/setup-e2e.ts` (a Jest `setupFiles`) sets `process.env.DB_NAME='event_ops_test'`
*before* ConfigModule loads `.env`, so the app connects to the test DB. `test/utils.ts`
provides `createTestApp()` (mirrors main.ts's `/api` prefix) + `login()` + seeded `ACCOUNTS`.

| Spec | Tests | What it covers |
|---|---|---|
| `test/auth.e2e-spec.ts` | 12 | Login (valid/wrong-pw/unknown-email), `JwtAuthGuard` (no/garbage token → 401), `/me`, and the **RolesGuard hierarchy over HTTP** via the `@Roles('eventmanager')` route: staff/manager → 403, eventmanager/admin → 200; an unguarded read still needs auth. |
| `test/events.e2e-spec.ts` | 11 | Event **permissions**: only eventmanager/admin create/edit/delete + manage members (manager/staff → 403); invalid date range → 400; `GET /events` membership scoping (member manager + admin see the event). Creates one event and deletes it in `afterAll`. |
| `test/raw-sql.e2e-spec.ts` | 10 | The hand-written **raw SQL** paths against real Postgres with a built-then-torn-down fixture: `getMemberIds`/`getManagerMemberIds`/`findForViewer`/`getEventManagers`, `findAllByEvent` assignee join + staff scoping, `deadlineRecipients` (assignee ∪ their manager ∪ event creator), `incomingReassignRequests`. |
| `test/role-hierarchy-access.e2e-spec.ts` | 14 | **RBAC boundary regression test (see below):** proves exact-match roles — Event Manager is denied Manager-only routes, Manager is denied Event-Manager routes, each role keeps its own, Admin is superuser. |
| `test/app.e2e-spec.ts` | 1 | Pre-existing root health scaffold (now passes after the AppModule fix). |

> ### ✅ Security fix: RBAC is now EXACT role match (was a level hierarchy)
> **Was:** `RolesGuard` checked the *minimum* level among the listed roles with
> `eventmanager(3) > manager(2)`, so an Event Manager's JWT was accepted on every
> Manager-gated route — they could create tasks, manage staff, and use the AI API even
> though the UI hid those buttons. UI hiding (`isManager`) was not a security boundary.
>
> **Now:** `roles.guard.ts` uses **exact role matching** — a route's `@Roles(...)` is an
> explicit allow-list with **no inheritance** between roles. `admin` is the only
> cross-role rule (system **superuser**, allowed everywhere). No decorator changes were
> needed — each route already listed exactly the non-admin role(s) intended; the guard
> just stops *unlisted* roles (e.g. eventmanager on a `@Roles('manager')` route) passing.
> Mirrors the frontend flags (`isManager = manager||admin`, `canManageEvents =
> eventmanager||admin`, `isAdmin`).
>
> `test/role-hierarchy-access.e2e-spec.ts` is the regression guard: Event Manager → **403**
> on `POST /tasks`, `GET/POST /users`, `POST /ai/command`; Manager → 403 on `POST /events`;
> Manager/Admin keep their own writes (201/200); Event Manager keeps event routes; Staff
> denied. Also covered by `auth/roles.guard.spec.ts` (unit) and `test/auth.e2e-spec.ts`.
> Docs corrected: `CLAUDE.md` Auth section + `README.md` (tech-stack row, Roles &
> Permissions intro, API access legend).

### Frontend unit + RTL tests (jsdom)

Added 2026-06-03 with `next/jest` (SWC transform, `@/`→`src` alias, jsdom). **Run from
`event-ops-frontend/`:** `npm test`. Config: `jest.config.ts` + `jest.setup.ts`
(`@testing-library/jest-dom`).

| Spec | Tests | What it covers |
|---|---|---|
| `src/lib/filters.test.ts` | 12 | `isEventNearby`/`isEventInMonth`/`isEventOnDate`/`isDeadlineNearby` with a fixed `now`: window edges, no-filter fallbacks, deadline-less tasks never hidden. |
| `src/lib/roles.test.ts` | 6 | `roleColorOf` (known + fallback) and `roleLabelOf` EN/VI + default. |
| `src/components/StatusBadge.test.tsx` | 3 | Renders the EN label per status/priority and falls back to Pending — rendered inside the real `LanguageProvider`. |

### Frontend Playwright happy paths (browser)

Added 2026-06-03. **Run from `event-ops-frontend/`:** `npm run test:e2e` (`playwright.config.ts`,
chromium). **PREREQ:** backend (3000) + frontend (3001) running — `reuseExistingServer` uses the
already-running dev frontend. All flows are **READ-ONLY** (login + navigation), forcing
`lang='en'` for deterministic text, so they don't mutate data.

`e2e/happy-path.spec.ts` (6): UI login → dashboard (`Total Events`); invalid creds show error +
stay on `/login`; dashboard's four stat cards; an authed manager opens `/events` and `/tasks`
(no bounce); an unauthenticated visit to `/tasks` redirects to `/login`. Navigation tests seed a
real JWT (fetched via the login API) into `localStorage` to skip the UI.

### Test gaps / next steps
- [x] **Controller/guard-wiring** — DONE via the backend e2e suite (auth + events).
- [x] **Raw-SQL paths** — DONE via `test/raw-sql.e2e-spec.ts` against `event_ops_test`.
- [x] **`users.service` full coverage** — DONE (reassignment + CRUD).
- [x] **Frontend tests** — DONE (RTL + Playwright).
- [ ] **e2e against a throwaway/Testcontainers DB in CI.** Today `event_ops_test` is a
      manually-created sibling DB in the same container; a CI job should create + seed it
      automatically (or use Testcontainers) so `npm run test:e2e` is self-contained.
- [ ] **Deeper Playwright flows** (create/edit an event or task end-to-end). Skipped here
      to stay non-destructive against the live dev DB; needs a dedicated test stack
      (backend on the test DB) so writes are safe.
- [ ] **Coverage thresholds + a combined CI test script** (backend unit+e2e, frontend
      unit, then Playwright) are not wired yet.

## Notifications now implemented

All are in-app (saved to `notifications` + pushed live over WebSocket) and bilingual EN/VI.

**Events**
- Added to an event (on create) → every new member (the chosen managers + all their staff).
- Added to an existing event via the member editor → that manager + their staff.
- Removed from an event via the member editor → that manager + their staff.
- Event completed (all tasks done) → every member.
- Event deleted → everyone who was a member.
- Event dates changed (shift/delete tasks) → every member.

**Staff → manager reassignment** (3 parties each, professional wording)
- Request: old manager ("you requested to move …"), new manager ("… wants to move … into your team"), staff ("you are being moved …, pending approval"). Staff stays in the old manager's projects until approval.
- Accept: old manager ("… has moved to …'s team"), new manager ("you received …"), staff ("you are now in …'s team"). Membership flips automatically (staff leaves old projects, joins new).
- Reject: old manager ("… declined; they stay in your team"), target ("you declined …"), staff ("your move was declined; you stay …").
- Cancel (owner withdraws before the target acts): old manager ("you withdrew the request to move …"), target ("the request to move … was withdrawn"), staff ("your pending move was cancelled; you stay …").

**Tasks**
- Assigned to a task → the staff member.
- Removed from a task → the staff member.
- New task added to an event → the event manager (the event's `created_by`), unless they
  created it themselves (`tasks.service.ts → create`).

**Deadlines (cron, every 30 min)**
- Reminder (due within 24h) and overdue alerts now reach the assigned staff **plus
  their owning managers plus the event manager** (`deadlineRecipients()` in
  `notifications.service.ts`). De-duplicated so the cron won't re-spam an unread alert.

> Bug fixed along the way: deleting a task/event now also clears its `notifications`
> rows (the `notifications.task_id` FK was blocking deletes once task notifications existed).

## Verified DONE since last pass (removed from the concern list)

- **Deadline alerts now reach managers** — `notifications.service.ts → deadlineRecipients()`
  unions task assignees + each assignee's `manager_id` + the event's `created_by`. Matches
  the brief ("assigned individuals **and** general event managers"). (commit `dacfaeb`)
- **"Mark all read" + notification history** — backend `getAll()` (capped at 50) and
  `markAllRead()` with a `/read-all` route; `NotificationBell.tsx` lists history and marks
  all read (single tick = one read, double tick = all read). (commits `4b396f7`, `d9e1680`)
- **Edit-event dates** — `PUT /events/:id/dates` + `eventsApi.updateDates`, with a
  `shift`/`delete` task strategy and a date editor modal on the Events page. (commit `532e369`)
- **Edit-event name/description** — clicking an event's name (event managers only) opens a
  details editor wired to `eventsApi.update` → `PUT /events/:id`. Description is optional and
  now shown on the card, collapsed behind "See more" when longer than 140 chars.
- **Cancel a pending reassignment** — `POST /users/:id/reassign/cancel` +
  `cancelReassign()`; the owner manager sees a red "Cancel request" button while a move is
  pending and can withdraw it before the target accepts/rejects (notifies all three parties).
- **New-task notification** — adding a task announces it to the event manager (see Tasks above).
- **Month/date/status/priority filters** — Events page filters by time scope (Nearby / Month /
  Date / All) + status; Tasks page filters by time scope (Nearby / All) + status + priority.
  Both default to **All** (shown first); **Nearby** = ±30 days around today
  (`src/lib/filters.ts`). Frontend-only over the already role-scoped lists; empty-filter
  states offer a one-click "Show all".
- **Tasks timeline + merged tasks** — replaced the 4-status board with a zoom/pan Gantt
  (`components/TaskTimeline.tsx`) from the event's start→end; each task is a block **coloured by
  its status**. Interactions: wheel = pan, Ctrl+wheel / buttons = zoom (to cursor), hold-drag =
  pan (mouse-left → content-right), right-click = context menu (empty → New Task; block → Edit /
  Ungroup / Delete; Edit opens a status/deadline/assignees panel). Managers **drag a block onto
  another to merge** into a **named parent task** (`task_groups` + `tasks.group_id`, migrated).
  **Grouping keeps each member's own time** (no span unification) — members are lane-packed so
  they never overlap (sequential A→B→C share a lane; overlapping ones stack). Ungroup just
  unlinks (time already preserved); group dissolves under 2 members. Filters still apply; a group
  stays visible if any member matches. `/tasks/groups/*` endpoints are manager-only.
  > NOTE: restart the running backend to load `/tasks/groups` (DB already migrated). The
  > `task_dependencies` table is still separate/unused — grouping ≠ ordering dependencies.
- **Unified dropdown UI** — one `components/Dropdown.tsx` (button + popup menu, mirrors
  EventPicker) replaced every native `<select>` (filters, create-task priority, create-user
  role, reassign-manager, the task-status changer) so the look + mechanism are identical app-wide.
- **Unified date/time/month inputs** — all date/time/month boxes (filters + create/edit forms +
  the task deadline editor) share the one global input style, and are typable + selectable. The
  month filter starts on the current month / today so it never shows an empty "----------" mask.
- **Checked the "0-task event crashes Tasks" report** — could NOT reproduce. `findAllByEvent`
  has an early return for 0 tasks (the only array query is safely behind it). Verified an event
  manager fetching a 0-task event returns `[]` cleanly on both the current repo code and the
  live server. No code change needed; if a crash recurs, capture the backend stack trace.
- **Schema robustness: FKs now `ON DELETE CASCADE`** — every foreign key that points at a
  task (`task_logs`, `task_assignments`, `task_dependencies` ×2, `ai_task_map`,
  `notifications.task_id`) plus `tasks.event_id` was switched to `ON DELETE CASCADE`, so
  deleting a task/event can no longer be blocked by or orphan its child rows. Fresh installs
  get this from `database_creating.txt`; existing DBs upgrade via
  `event-ops-backend/migrations/2026-06-02_fk_on_delete_cascade.sql` (run `npm run db:migrate`,
  idempotent). Applied + verified on the dev DB (all 8 FKs now cascade). The services still
  clear child rows by hand as a harmless fallback for un-migrated databases.
- **Dropped the unused `milestones` table feature** — the per-event "milestone" progress is
  derived by `MilestoneBar.tsx` (completed/total tasks); the separate `milestones` table had
  no UI and no data, so the entity, service methods, controller routes, `tasksApi`/`Milestone`
  type helpers, and the DDL table were all removed. For an existing dev DB you can
  `DROP TABLE IF EXISTS milestones;` (harmless to leave; it just sits empty).

## Missing / needs fixing (still open, verified)

- [ ] **AI is create-only.** `ai.service.ts → processCommand` still only parses a prompt into
      a JSON array of *new* tasks and creates them. No update / reassign / restructure,
      despite the brief asking the AI to "reassign responsibilities, or restructure task lists
      dynamically." **Largest gap vs. the spec.**
- [ ] **Task dependencies are unused.** `task_dependencies` table + `TaskDependency` entity
      exist, but the only code that touches the table is cleanup-on-delete
      (`events.service.ts:277`, `tasks.service.ts:209`). Nothing creates/reads a dependency,
      and `tasks.service.ts` injects `depRepo` but never uses it. Needed if AI milestone
      recalculation is built; otherwise remove the table, entity, and injection.
- [x] **Removing the last manager / empty event** → resolved (allow freely, warn the manager).
      No backend guard/confirm; a 0-member event highlights its card amber (border + glow) with
      a clickable "No members yet — add a manager" warning banner, shown only to those who can
      manage members. Headcount chip also reads "No members" in amber.

## Features that could be improved / added (nice-to-have, not blocking)

- [ ] **AI conversational editing** (the big one): let a prompt target existing tasks —
      "push everything back two days", "move Bob's tasks to Carol", "split setup into 3
      milestones". Requires AI access to the current task list + a verb other than "create",
      and would finally exercise `task_dependencies` / `milestones`.
- [ ] **Notification pruning / pagination.** History is capped at 50 rows on read but rows
      are never deleted — the table grows unbounded. Add a retention job or paginate.
- [ ] **Event detail page.** `eventsApi.getOne`, `tasksApi.getOne`, `usersApi.getOne` all
      exist with no consumer; a per-event detail view could use them instead of leaving them dead.
- [ ] **Bulk task assignment / filtering** on the Tasks page (by assignee, by status).
- [ ] **Deadline reminder cadence** is fixed at 24h / 30-min cron. Make the reminder window
      configurable per event or per task priority.
- [ ] **Email / push delivery.** Notifications are in-app + WebSocket only; an email or
      browser-push channel would help managers who aren't logged in.

## Unused / dead code to review (verified — confirm before deleting)

**Backend**
- `TasksService.findOverdue()` (`tasks.service.ts:265`) — no caller anywhere (the cron runs
  its own query). Dead.
- `TasksService` injects `depRepo` (`tasks.service.ts:26`) but never uses it. Dead injection
  (tied to the unused task-dependencies feature above).
- **NOTE — not dead:** `TasksService.assignUser()` *is* still used — `ai.service.ts:136` calls
  it when the AI names an assignee. Only the **HTTP endpoint** `POST /tasks/:id/assign`
  (`tasks.controller.ts:82`) is unused by the frontend (which assigns via
  `PUT /tasks/:id/assignments` → `setAssignees`). Keep the method; the route can go.
- `DELETE /tasks/:id/assign/:userId` → `unassignUser()` (`tasks.controller.ts:105`,
  `tasks.service.ts:334`) — no internal caller, not called by the frontend. Dead.
- `GET /tasks/:id/assignments` → `getAssignments()` (`tasks.controller.ts:71`,
  `tasks.service.ts:276`) — not called by the frontend (the task list embeds assignees). Dead.
- `PUT /users/:id/deactivate` → `UsersService.deactivate()` (`users.controller.ts:158`) —
  the Team page toggles active state via `usersApi.update({ is_active })`; this endpoint is unused.

**Frontend (`src/lib/api.ts` helpers defined but never called)**
- `usersApi.deactivate`, `usersApi.getOne`
- `eventsApi.getOne` (`eventsApi.update` is now wired by the details editor)
- `tasksApi.getOne`, `tasksApi.assign`, `tasksApi.unassign`
