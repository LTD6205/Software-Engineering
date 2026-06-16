# Task Management Enhancements — Design

Date: 2026-06-16

Four improvements to the event-ops task subsystem. All four live in `tasks` and reuse existing
authorization (`assertCanViewEvent` / `assertCanManageEvent` + role guards). The hard guard rules
(not-in-past, event-window, undo) and the real status lifecycle stay untouched.

## Feature 1 — Task list view with filtering & sorting

Frontend only. No backend or DB change.

- `app/tasks/page.tsx` gains `viewMode: 'timeline' | 'list'` state and a toggle button. Default
  stays timeline.
- List view renders a table over the **already-fetched** event tasks (no new fetch). Columns:
  name, real status, custom progress label (Feature 3), priority, assignees, start, deadline, group.
- Reuse the existing `matches()` predicate (status + priority filters) and `resetTaskFilters()`.
- **Add** a sort control: by deadline / priority (priority_score) / start / name, ascending or
  descending. Client-side sort on the same task array. Default: priority desc, deadline asc
  (mirrors backend `findAllByEvent` ordering).
- Reuse the existing inline panel (rename / status / reassign / merge / ungroup) and Ctrl/Cmd-click
  multi-select + batch delete/ungroup. Both views share one filter/selection state.

## Feature 2 — Managers can assign tasks to themselves

- Backend `assertAssignable` (`tasks.service.ts:948`) currently requires the assignee `role === 'staff'`
  and, for a manager actor, that the assignee is their own staff. Relax: also permit the **actor
  assigning themselves** when the actor is `manager` or `admin`. `task_assignments` has no role
  constraint, so no DB change.
- Frontend `assignableStaff` (`tasks/page.tsx:67`): include the current user in the assignable list
  when `isManager`, so a manager appears as a selectable assignee on their own tasks.
- AI: the existing assign/reassign path runs through `assertAssignable`, so once the service allows
  self-assign, AI managers inherit it. No catalog change required for this feature.

## Feature 3 — Custom progress labels (reusable, per-event)

Layered on top of the real lifecycle. `in_progress` / `completed` / `overdue`, the cron auto-overdue
job, priority automation, and existing AI status handling are **unchanged**. A custom status is a
display/tracking label only; automation never reads it.

### Data model
- **New table** `task_custom_statuses`:
  - `status_id` UUID PK, `event_id` UUID FK → events `ON DELETE CASCADE`, `name` text,
    `color` text NULL, `created_by` UUID FK → users, `created_at` timestamptz default now().
  - Unique `(event_id, lower(name))`.
- **New column** `tasks.custom_status_id` UUID NULL, FK → `task_custom_statuses` `ON DELETE SET NULL`.
- New entity `TaskCustomStatus` in `src/entities/`; add `custom_status_id` field to `Task` entity.
- Migration SQL in `event-ops-backend/migrations/` + hand-sync `database_creating.txt`.

### Endpoints & rules
- `GET /tasks/event/:eventId/custom-statuses` — any event member (gated by `assertCanViewEvent`).
- `POST /tasks/event/:eventId/custom-statuses` `{ name, color? }` — any event member
  (`assertCanViewEvent`); managers/staff alike, matching "tasks they manage or are assigned to".
- `DELETE /tasks/custom-statuses/:statusId` — creator or event manager/admin. FK `SET NULL` detaches
  it from any tasks using it.
- Setting a task's `custom_status_id` rides the **existing** `PUT /tasks/:id` (add field to the DTO/patch),
  gated by the same "creator or assignee" rule used by `assertStatusChangeAllowed`. Because it flows
  through `update()`, it is captured in the undo change-log and emits the `data_changed` broadcast for free.

### Frontend
- Small "manage statuses" modal (list + add + delete) per selected event.
- Dropdown on a task to pick / clear its custom status.
- Render the custom status as a colored chip in both list and timeline views.
- Custom-status filter option in the list view.

## Feature 4 — Task linking + linked-task visibility for staff

Wire up the dormant `task_dependencies` table as a **generic symmetric "related" link**. No dependency
ordering, no scheduling enforcement — purely a relationship for visibility and filtering.

### Data model
- New entity `TaskDependency` over the existing `task_dependencies` table (`dependency_id` PK,
  `task_id` FK, `depends_on_task` FK; existing no-self and unique `(task_id, depends_on_task)`
  constraints stay). No schema change needed (table already exists); add to `database_creating.txt`
  notes that it is now wired.

### Endpoints & rules
- `GET /tasks/:id/links` — viewers of the task's event; returns linked tasks (querying **both**
  columns so the link is treated as symmetric).
- `POST /tasks/:id/links` `{ targetTaskId }` — actor must be creator/assignee of the source task
  (staff) or manager/admin of the event. Both tasks must belong to the **same event**.
- `DELETE /tasks/:id/links/:targetId` — same authorization as create.

### Visibility change
- `findAllByEvent` staff scoping (`tasks.service.ts:79`): staff currently receive only their assigned
  tasks. **Add** tasks that are **linked to** any of their assigned tasks, returned read-only. The
  frontend already gates editing by creator/assignee, so linked-but-not-assigned tasks render
  non-editable without extra flags.

### Frontend
- Link / unlink UI in the task inline panel (pick a target task in the same event).
- List-view filter "linked to my tasks".
- Linked tasks a staffer doesn't own/aren't assigned to appear read-only.

## Feature parity for AI (managers/admin)

The AI drawer is available to managers and organizers only; staff have no AI. So AI parity covers the
new abilities **within AI's existing actor roles** (manager/admin for task-scoped actions). Add to
`ai.catalog.ts` / `ai.validate.ts` / `ai.resolve.ts` / `ai.service.ts`, gated in `AI_ACTION_ROLES`:

- `update` action gains an optional `custom_status` field (resolved by name within the task's event →
  `custom_status_id`; unknown name → insufficient-info rejection or auto-create per existing patterns —
  decide in plan, default to resolve-or-reject for safety).
- `create_custom_status` `{ event, name, color? }`.
- `link_tasks` `{ task, target }` and `unlink_tasks` `{ task, target }`.
- Self-assign needs no new action (covered by Feature 2's service relaxation).

All AI task changes still go through `TasksService`, so event-window, not-in-past, authorization, and
undo rules apply identically.

## Scope cuts (YAGNI)

- Task **links** are not recorded in the undo change-log (kept simple); custom-status changes are
  (free, via `update()`).
- Custom statuses are display-only — deliberately not fed into cron/priority automation.
- Links are symmetric "related" only — no dependency graph, ordering, or blocking semantics.

## Testing

- Backend unit specs (hand-rolled mock repos, per existing pattern) for: `assertAssignable` self-assign,
  custom-status CRUD authorization, link create/delete authorization + same-event check, and the
  `findAllByEvent` linked-visibility expansion for staff.
- AI validate/resolve specs for the new actions.
- Frontend: list view filter/sort behavior; manager appears in assignable list; custom-status chip and
  filter; linked-task read-only rendering.
