# AI Operations Partner — Design Spec

**Date:** 2026-06-05
**Status:** Approved design (Approach A-extended), ready for implementation planning
**Area:** `event-ops-backend/src/ai/` + `event-ops-frontend/src/app/ai/`

## Goal

Turn the AI Assistant into a **role-aware operations partner** usable by **Admin, Organizer, and Manager**, able to perform **any action that role is allowed to perform** and to **answer questions** about the data that role can see — including **generative planning** ("I have a birthday party, create all the tasks"), a manager-controlled **Auto-accept / Ask** confirmation mode, and a **clarification loop** for ambiguous requests.

### In scope
- **Three roles** access the AI: Admin, Organizer, Manager. (Staff still excluded — they have no write surface.)
- **All writes each role is allowed**, routed through existing services:
  - **Manager**: full task actions + own-staff management (create/edit staff, staff-reassignment flow).
  - **Organizer**: event create/edit/delete + event-manager membership.
  - **Admin**: everything the above can do **plus** account management (create any role, change roles, reset passwords, activate/deactivate).
- **Reads / Q&A**: answer questions scoped to what the actor can view.
- **Generative decomposition**, **Auto-accept / Ask** confirmation, and the **clarification loop**.
- **Contextual access (no standalone panel)**: the dedicated AI page is removed; the AI is a global, route-aware slide-over drawer so the user keeps seeing the live data (an event's tasks, the events list) while the AI acts on it.

### Out of scope
- Anything no role can do through the existing API.
- A multi-step tool-calling agent loop (Approach B). Reads are answered from a role-scoped context block, not arbitrary live queries (see Limitations).

## Safety model (load-bearing principle)

Every AI action is executed by calling the **existing service method** (`TasksService`, `EventsService`, `UsersService`), passing the **actor's verified JWT identity** — never a privileged/system actor.

**Two enforcement layers, because authorization in this codebase is split between controllers and services:**

1. **AI-side role gate (required).** Some authorization lives only in the controllers, not the services — e.g. `EventsService.create/update/remove/addManager/removeManager` take no actor and do no role/ownership check (the `@Roles('organizer')` guard is the only gate); `UsersController` enforces `assertCanAssignRole` and the admin-only `is_active` rule before calling the service; and `TasksService` enforces event *membership* but not *role* (an organizer member would pass its `assertCanManageEvent`). Therefore `AiService` MUST enforce, per action, a **role allow-list** (task→manager/admin; event→organizer/admin; account→manager-staff/admin) **and** replicate the controller-level checks (`assertCanAssignRole`, admin-only `is_active`, and `assertCanManageEvent` for an existing event/membership target) before calling the no-actor services. A disallowed action is skipped into `rejected[]`.
2. **Service-side gate (defense in depth).** Services still enforce what they own: event-membership policy, "assignee must be own staff", event-window/no-past-date rules, active-manager-only membership, etc.

The AI layer therefore adds exactly one new authorization surface — the per-action role gate that mirrors the controllers — and otherwise delegates to existing service checks. Prompt role-gating (advertising only allowed actions) is a UX measure on top; it is **not** relied on for safety.

## 1. Role-aware action catalog

The model returns a JSON array of action objects (an item with no `action` defaults to `create`, backward compatible). The **system prompt advertises only the action types allowed for the actor's role**; services enforce regardless. Each action resolves references and routes to one service call.

**Task actions** — Manager, Admin (within an event the actor manages):
| Action | Fields | Service |
|---|---|---|
| `create` | `task_name`, `priority`, `assigned_to`, `deadline`, `group?`, `event_ref?` | `TasksService.create` (+ assign, + grouping) |
| `update` | `task_ref`, changed fields | `update` |
| `reassign` | `task_ref`, `assigned_to` | `setAssignees([one])` |
| `unassign` | `task_ref` | `setAssignees([])` |
| `delete` | `task_ref` | `remove` |
| `merge` | `task_ref`, `target_ref` | `merge` |
| `add_to_group` | `group_ref`, `task_ref` | `addToGroup` |
| `rename_group` | `group_ref`, `title` | `renameGroup` |
| `ungroup` | `task_ref` | `ungroup` |

**Event actions** — Organizer, Admin:
| Action | Fields | Service |
|---|---|---|
| `create_event` | `event_name`, `start_time`, `end_time`, `description?` | `EventsService.create` |
| `update_event` | `event_ref`, changed fields | `EventsService.update` |
| `delete_event` | `event_ref` | `EventsService.remove` |
| `add_event_manager` | `event_ref`, `manager_ref` | membership add |
| `remove_event_manager` | `event_ref`, `manager_ref` | membership remove |

**Account / team actions** — Manager (own staff) and Admin (all, incl. sensitive):
| Action | Fields | Service | Allowed |
|---|---|---|---|
| `create_user` | `name`, `email`, `role?`, `phone?` | `UsersService.create` | Manager → staff only; Admin → any role |
| `update_user` | `user_ref`, profile/`role?`/`is_active?` | `UsersService.update` | Manager → own staff profile; Admin → all incl. role/activate |
| `reset_password` | `user_ref`, `new_password` | `UsersService.update` | Admin only |
| `request_reassign` | `staff_ref`, `target_manager_ref` | `requestReassign` | Manager, Admin |
| `accept_reassign` / `reject_reassign` / `cancel_reassign` | `staff_ref` | respective service method | Manager, Admin |

> The service layer is authoritative: e.g. a manager emitting `update_user` with `is_active` or a non-staff `role` is rejected by `UsersController`/`UsersService`'s existing checks → lands in `rejected[]`.

**Reference resolution**
- `task_ref` / `target_ref`: exact id, else case-insensitive name (existing `resolveTaskRef`). Tasks created earlier in the same batch are referenceable by name.
- `group_ref`: exact `group_id`, else case-insensitive group title, from the event's groups.
- `event_ref`: exact `event_id`, else case-insensitive event name, from the actor's viewable events. Defaults to the request's `eventId` when present and omitted.
- `manager_ref` / `user_ref` / `staff_ref` / `target_manager_ref`: exact `user_id`, else case-insensitive name or email, from the roster in context. Unresolved → `unresolved[]`.

**Grouping new tasks (`group` field).** A `create` may carry an optional `group` (title). After creates run, tasks sharing the same `group` value are linked into one group — reuse an existing event group whose title matches (case-insensitive), else create it. Enables one-shot grouped generation.

**Limits.** `validateActions` recognizes all actions; malformed items are dropped and counted in `skipped`. A **max of 40 actions per command** is enforced; overflow is dropped and reported.

## 2. Generative planning

Prompt-driven, no new control flow. For a high-level goal ("birthday party, create all the tasks") the model decomposes into a complete checklist with sensible deadlines **inside the event window**, groups related tasks via `group`, and distributes `assigned_to` across the roster. The team roster (assignable, active users for the actor — a manager's own staff; for organizer/admin, the event's participating staff) is included in the prompt; assignments still pass through `setAssignees`, which silently skips a disallowed assignee.

## 2b. Reads / Q&A

When the user asks a question rather than commands an action, the model returns:
```jsonc
{ "answer": "3 events are behind schedule: 'Gala' (2 of 8 done)…" }
```
The backend returns `{ status: 'answered', answer }`. The answer is generated from the **role-scoped context block** included in the prompt (see §3). DB status logged as `success`.

## 2c. Clarification loop

When a command is genuinely ambiguous or missing an essential detail the model cannot reasonably infer, it returns:
```jsonc
{ "clarification_needed": true, "question": "Which event — 'Birthday Party' or 'Gala'?" }
```
Backend returns `{ status: 'needs_clarification', request_id, question }`. The conversation is **stateless on the server**: the frontend resends the running transcript as `history`, so the model has full context and can then act. **Anti-nag rule (prompt-enforced):** prefer sensible defaults; ask only when truly blocked — generative goals must not trigger a question. Order: `command → (optional clarification turns) → answer | action plan → (auto: execute | ask: preview → confirm)`.

## 3. Backend flow, context & endpoints

`@Controller('ai')`, `@UseGuards(JwtAuthGuard, RolesGuard)`, `@Roles('organizer', 'manager', 'admin')`.

**Role-scoped context block** (built per request, fed into the system prompt):
- The actor's role, today's date-time.
- **Events** the actor can view (`EventsService.findForViewer`) — name, id, window, `task_count`, `completed_count`, people/manager counts. Capped to the **20 nearest by deadline** for large rosters (overflow noted).
- The **current event's tasks** (if `eventId` given) — name, id, status, deadline, assignees, group title — and that event's groups.
- The **roster** the actor can assign/manage (manager's staff; organizer/admin: event/participating staff), capped at a sane size.

This block powers both `answer` (reads) and reference resolution / assignment (writes).

**Endpoints**
- `POST /api/ai/command` — body `{ eventId?, message, mode?: 'auto' | 'ask', history?: {role,content}[] }`. `eventId` is now **optional** (commands like "create an event" or cross-event questions need none); when present it sets the default event for task actions and loads that event's task context. `mode` defaults to `auto`, `history` to `[]`.
  - **answer** → return `{ status: 'answered', answer }`.
  - **needs_clarification** → return the question.
  - **auto** → resolve → `executeActions(...)` → results.
  - **ask** → resolve + validate → persist plan (validated actions + any `eventId`) to the `ai_requests` row (status `awaiting_confirmation`) → return preview.
- `POST /api/ai/command/:requestId/confirm` — assert request belongs to the caller, status `awaiting_confirmation`, age ≤ **15 min** (else `400 expired`); re-run stored actions via `executeActions` (fresh re-resolution); status `success`; return results.
- `POST /api/ai/command/:requestId/cancel` — same checks; status `cancelled`.

**Auth note.** The upfront single-event manage-check is replaced by: if `eventId` is supplied, assert the actor can **view** it (for context); all **write** authorization is per-action inside the services. Rate limit still applies before the LLM spend.

**Refactor.** One private `executeActions(actions, defaultEventId, actor, aiRequestId)` is the single execution path for both auto and confirm. `AiService` gains `UsersService` (and uses existing `EventsService`) as collaborators.

## 4. Response contracts

**Results** (auto/confirm) — additive over today:
```jsonc
{
  "status": "success",
  "tasks_created": [...], "tasks_updated": [...], "tasks_reassigned": [...],
  "tasks_deleted": [...], "unassigned": [...], "groups_changed": [...],
  "events_changed": [ { "action", "event_id", "event_name?" } ],
  "users_changed":  [ { "action", "user_id", "summary" } ],
  "unresolved": [...], "rejected": [ { "ref|task_name", "reason" } ], "skipped": 0
}
```
**Preview** (ask): `{ status: 'pending_confirmation', request_id, plan: [{ kind, description, detail }], unresolved, skipped }`.
**Answer**: `{ status: 'answered', answer }`.
**Clarification**: `{ status: 'needs_clarification', request_id, question }`.

## 5. Frontend — contextual AI surface (replaces the standalone panel)

> Read the Next.js 16 / React 19 guides in `event-ops-frontend/node_modules/next/dist/docs/` before changing frontend code, per `CLAUDE.md`.

**Remove the standalone AI page.** Delete `src/app/ai/page.tsx` and the Sidebar nav item (`Sidebar.tsx:29`). The AI is no longer a separate destination you navigate *to*; it comes *to* the page you're working on.

**New access pattern — a global, context-aware AI drawer.** A single `<AiDrawer>` component is mounted once in `AppShell` and toggled by a launcher button (header/FAB), visible to organizer/manager/admin (`isManager || canManageEvents || isAdmin`). It is a **non-modal slide-over**: the page behind stays mounted and visible, so the user keeps seeing their tasks/events while they converse with the AI.

**Context comes from the current route**, so the AI works *where the work is*:
- On the **tasks** view of an event → the drawer passes that `eventId`; task commands and questions target it, and the **timeline/list behind refreshes live** as actions land.
- On the **events** page → no `eventId`; event creation, cross-event commands, and "which events are behind?" questions work against the actor's viewable events; the **events list behind refreshes live**.
- Elsewhere → general/clarifying behavior with whatever context the route provides.

**Live updates need no new wiring.** AI actions go through `TasksService`/`EventsService`, which already broadcast `data_changed`; the open page already refetches via `useLiveData`. So "create a task with AI and watch it appear in this event" works automatically.

**Drawer behavior:**
- **Auto-accept / Ask** toggle, persisted in `localStorage` (`ai_confirm_mode`, default `auto`).
- In-component **conversation transcript** (`{role,content}[]`), sent as `history`; append each turn.
- Render by response `status`:
  - **answered** → show the answer text.
  - **needs_clarification** → show `question` + an answer input; on submit append to transcript and re-`POST /command`.
  - **pending_confirmation** → list `plan` `description`s with **Confirm** / **Cancel** → call the respective endpoint.
  - **success** → concise results summary (tasks/events/users/groups changed + unresolved/rejected/skipped). The page itself reflects the changes live.
- Sends `{ eventId?, message, mode, history }`; uses the existing `api` axios instance / endpoint helpers.

## 6. Persistence / migration

- `migrations/2026-06-05_ai_request_confirmation_status.sql` (idempotent): drop `ai_requests_status_check`, recreate allowing `pending`, `success`, `rejected`, **`awaiting_confirmation`**, **`cancelled`**, **`needs_clarification`**. (`answered` reuses `success`.)
- Mirror the widened CHECK in `database_creating.txt`.
- No new columns: the plan (+ `eventId`) lives in the existing `response` JSONB.

## 7. Error handling

- One bad action never aborts the batch: unmatched refs → `unresolved[]`; service rejections (window/past/permission/foreign assignee/disallowed account change) → `rejected[]`.
- `confirm`/`cancel` on missing/foreign/already-applied/cancelled/expired request → `404`/`403`/`400`, bilingual messages.
- Non-array, non-`answer`, non-`clarification` LLM output → `rejected` ("insufficient info"), regardless of mode.

## 8. Testing

Extend `src/ai/ai.service.spec.ts` (keep existing 13 green; hand-rolled mock repos/services as the file does). Add mocks for `UsersService` and `EventsService` write/membership methods.
- Each new action routes to the right service method (task, event, account families).
- `group` field links same-titled creates into one group; generative path executes N creates.
- **Role-gating end-to-end via services**: a manager actor's `create_event` / sensitive `update_user(is_active)` is rejected (service throws → `rejected[]`); an organizer's `create_event` succeeds; an admin's account actions succeed (mocked).
- `answer` path: a question returns `status: 'answered'` and calls no mutating service.
- `mode: 'ask'` returns `pending_confirmation`, mutates nothing, persists `awaiting_confirmation`; `confirm` executes; `cancel` cancels; ownership/expiry guards (403/400).
- `needs_clarification` returned when blocked; `history` forwarded into LLM `messages` in order; anti-nag: a generative goal yields actions, not a question.
- `delete`/unresolved ref → `unresolved[]`, not thrown. Action cap > 40 truncated and counted.

E2E (`test/`) stays AI-inert; confirm/cancel/guard logic covered by unit tests.

## Limitations / assumptions

- **Reads are best-effort over the provided context block**, not arbitrary deep queries. Questions answerable from events/tasks/roster summaries work well; highly specific cross-entity analytics may not. Upgrading to a tool-calling agent (Approach B) is the future path if needed.
- Auto-assignment strategy is left to the model (spread sensibly); no server-side round-robin.
- Sensitive admin actions (roles/passwords/activation) are permitted but, like all writes, are subject to the Auto-accept / Ask toggle — managers/admins can require a confirm step.
- Context-block caps (20 events, bounded roster) bound prompt size for large admin datasets; overflow is disclosed in the block.
