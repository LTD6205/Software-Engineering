# TODO — Event Ops

Working notes on what was added, what's still missing, and dead code to review.
Last updated 2026-06-02 (re-verified against source).

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
- [ ] **Removing the last manager** leaves an event with 0 members (headcount 0).
      `removeManager()` has no guard and no empty-state warning. Add a guard or a clear
      empty-state.

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
