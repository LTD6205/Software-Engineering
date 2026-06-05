# AI Manager Partner — Design Spec

**Date:** 2026-06-05
**Status:** Approved design (Approach A), ready for implementation planning
**Area:** `event-ops-backend/src/ai/` + `event-ops-frontend/src/app/ai/`

## Goal

Turn the AI Assistant from a narrow task-creation tool into a **supportive partner for managers** that can perform any *task-level* action a manager can, including **generative planning** — e.g. "I have a birthday party, create all the tasks" produces a complete, grouped, auto-assigned task list — with a manager-controlled **Auto-accept / Ask** confirmation mode.

### In scope
- Full task-level action set (create, update, reassign, **unassign, delete, merge, add-to-group, rename-group, ungroup**).
- **Generative decomposition**: a high-level goal expands into a realistic set of tasks, grouped and assigned across the team.
- **Auto-accept / Ask** toggle: in Ask mode the AI returns a preview that the manager confirms before anything is applied.
- **Clarification loop**: when a command is genuinely ambiguous or missing an essential detail it cannot reasonably assume, the AI asks a concise follow-up question instead of guessing, then continues once the manager answers.

### Out of scope (unchanged)
- Reading / Q&A ("what's overdue?") — not added now.
- Team management (create staff, reassignment flow) — not added now.
- Anything a manager cannot do: event CRUD (organizer-only), roles/passwords/activation (admin-only). The AI is bounded by the manager's own permissions automatically (see Safety model).

## Safety model (the load-bearing principle)

Every AI action is executed by calling the **existing `TasksService` method**, passing the **manager's verified JWT identity** as the actor — never a privileged/system actor. Therefore the AI is inherently bounded by exactly what that manager could do: event-membership policy, "assignee must be own staff", event-window and no-past-date rules, etc. are all re-enforced by the services. The AI layer adds **no** new authorization paths; it only orchestrates calls the manager could already make.

## 1. Action schema

The model continues to return a JSON array of action objects. An item with no `action` defaults to `create` (backward compatible). Each action resolves references and routes to one service call:

| Action | Fields | Service call |
|---|---|---|
| `create` | `task_name`, `priority`, `assigned_to`, `deadline`, **`group?`** | `create` (+ `setAssignees`, + grouping) |
| `update` | `task_ref`, `task_name?`, `priority?`, `deadline?`, `status?` | `update` |
| `reassign` | `task_ref`, `assigned_to` | `setAssignees([one])` |
| `unassign` | `task_ref` | `setAssignees([])` |
| `delete` | `task_ref` | `remove` |
| `merge` | `task_ref` (source), `target_ref` | `merge` |
| `add_to_group` | `group_ref`, `task_ref` | `addToGroup` |
| `rename_group` | `group_ref`, `title` | `renameGroup` |
| `ungroup` | `task_ref` | `ungroup` |

**Reference resolution**
- `task_ref` / `target_ref`: exact `task_id`, else case-insensitive `task_name` (existing `resolveTaskRef`). Newly-created tasks in the same batch are appended to the in-memory task list so later actions can reference them by name.
- `group_ref`: exact `group_id`, else case-insensitive group `title`, resolved from the event's existing groups (`{group_id, title}`).

**Grouping newly-created tasks (the `group` field).** Rather than emit fragile `merge` actions for tasks that don't exist yet, a `create` action may carry an optional `group` (a group title). After all creates run, tasks that share the same `group` value are linked into one group: reuse an existing event group whose title matches (case-insensitive), otherwise create the group from that title. This is what makes "create all the tasks, grouped" work in one shot.

**Validation / limits**
- `validateActions` is extended to recognize the new actions; malformed items (missing required ref/name) are dropped and counted in `skipped` (existing behavior).
- A **max of 40 actions per command** is enforced; extras are dropped and surfaced in the response (`skipped` + a note), so a runaway generation can't flood the board.

## 2. Generative planning

Achieved entirely through the system prompt — no new control flow. The prompt is extended to tell the model:
- When the manager gives a **high-level goal** (e.g. "I have a birthday party, create all the tasks"), decompose it into a **complete, realistic checklist** of concrete tasks.
- Give each task a sensible **deadline inside the event window** (reusing the existing hard date-window constraint already in the prompt).
- **Group** related tasks by setting the same `group` title (e.g. "Catering", "Decoration", "Logistics").
- **Distribute assignments** across the provided team roster (round-robin / by sensible fit), using `assigned_to`.

**Team roster in the prompt.** The prompt gains the manager's **assignable, active staff** (display name + email). Source: the manager's own staff (`users.manager_id = actor.sub`, `is_active = true`). For an admin/organizer actor (no owned staff), the roster is the event's participating staff; if empty, the model is told to leave tasks unassigned. Assignments still go through `setAssignees`, which re-validates that each assignee is permitted — an out-of-team suggestion is silently skipped, never failing the command (existing `tryAssign` behavior).

## 2b. Clarification loop

When a command is genuinely ambiguous or missing an essential detail the model cannot reasonably infer from the event/team context, the model returns a **clarification object** instead of an action array:

```jsonc
{ "clarification_needed": true, "question": "Which event do you mean — 'Birthday Party' or 'Gala'?" }
```

The backend turns this into `{ status: 'needs_clarification', request_id, question }`. The conversation is **stateless on the server**: the frontend keeps the running transcript and resends it as `history` (see request body) on the next call, so the model has the full context (original command → its question → the manager's answer) and can now produce actions (or ask once more).

**Anti-nag rule (prompt-enforced).** The model is told to **prefer sensible defaults over asking** and to ask **only when it truly cannot act** without the missing detail. High-level generative goals ("create all the tasks for a birthday party") must **not** trigger a question — the model fills in a reasonable plan. Clarification is reserved for blockers like an unresolvable referent ("assign it to her" with no prior person) or an ambiguous event/task reference.

This loop runs **before** any plan/confirm step: `command → (optional clarification turns) → produce actions → (auto: execute | ask: preview → confirm)`.

## 3. Backend flow & endpoints

All under `@Controller('ai')`, `@UseGuards(JwtAuthGuard, RolesGuard)`, `@Roles('manager')` (+admin).

- `POST /api/ai/command` — body `{ eventId, message, mode?: 'auto' | 'ask', history?: { role: 'user' | 'assistant', content: string }[] }`. `mode` defaults to `'auto'` and `history` to `[]` (existing clients keep working). `history` (prior turns) is inserted into the chat `messages` after the system prompt and before the latest `message`, giving the model conversational context for the clarification loop.
  - **auto**: LLM → resolve → `executeActions(...)` → return results.
  - **ask**: LLM → resolve + validate → persist the plan (the validated `AiAction[]` plus `eventId`) into the `ai_requests` row's `response` JSONB, set status `awaiting_confirmation` → return the **preview** (no execution).
- `POST /api/ai/command/:requestId/confirm` — load the request; assert it **belongs to the calling user** (`user_id === actor.sub`), status is `awaiting_confirmation`, and `created_at` is within **15 minutes** (else `400 expired`); re-run the stored actions via `executeActions(...)` (fresh re-resolution against current data — handles drift), set status `success`, return results.
- `POST /api/ai/command/:requestId/cancel` — same ownership/state checks; set status `cancelled`; return `{ status: 'cancelled' }`.

**Refactor.** The per-action execution loop is extracted into a single private `executeActions(actions, eventId, actor, aiRequestId)` returning the result buckets below. Both the auto path and `confirm` call it, so there is exactly one execution code path.

## 4. Response contracts

**Results** (auto and confirm) — existing arrays unchanged, new ones added:
```jsonc
{
  "status": "success",
  "tasks_created":    [ /* task objects */ ],
  "tasks_updated":    [ /* task objects */ ],
  "tasks_reassigned": [ { "task_id", "task_name", "assigned_to" } ],
  "tasks_deleted":    [ { "task_id", "task_name" } ],
  "unassigned":       [ { "task_id", "task_name" } ],
  "groups_changed":   [ { "action", "group_id", "title?" } ],
  "unresolved": [ "refs the model named but couldn't be matched" ],
  "rejected":   [ { "task_name", "reason" } ],
  "skipped":    0
}
```

**Preview** (ask):
```jsonc
{
  "status": "pending_confirmation",
  "request_id": "uuid",
  "plan": [ { "kind": "create|update|delete|merge|...", "description": "Delete task 'Book venue'", "detail": { /* resolved fields */ } } ],
  "unresolved": [ ... ],
  "skipped": 0
}
```
`description` is a human-readable line the UI lists verbatim.

**Clarification** (either mode, when the model asks back):
```jsonc
{ "status": "needs_clarification", "request_id": "uuid", "question": "Which event do you mean?" }
```

## 5. Frontend (`src/app/ai/page.tsx`)

> Read the relevant guide in `event-ops-frontend/node_modules/next/dist/docs/` before changing frontend code (Next.js 16 / React 19), per `CLAUDE.md`.

- Add an **Auto-accept / Ask** toggle to the AI panel, persisted in `localStorage` (e.g. `ai_confirm_mode`), default `auto`.
- Maintain a small in-component **conversation transcript** (`{role, content}[]`); send it as `history` with each command and append each turn.
- Send `mode` and `history` with each command.
- **auto**: render the results summary as today, extended to mention deletes/unassigns/group changes.
- **ask**: render the returned `plan` as a checklist of `description` lines with **Confirm** and **Cancel** buttons. Confirm → `POST .../confirm` → show results. Cancel → `POST .../cancel`. While awaiting confirmation, disable re-sending.
- **needs_clarification**: render the `question` and show an answer input; on submit, append the question (assistant) + answer (user) to the transcript and re-`POST /command` with the updated `history`. Clarification works in both modes and precedes any preview/confirm.
- Use the existing `api` axios instance / endpoint helpers.

## 6. Persistence / migration

- New migration `migrations/2026-06-05_ai_request_confirmation_status.sql` (idempotent, follows existing convention): drop the `ai_requests_status_check` CHECK and recreate it allowing `pending`, `success`, `rejected`, **`awaiting_confirmation`**, **`cancelled`**, **`needs_clarification`**.
- Mirror the widened CHECK in `database_creating.txt` (kept in sync by hand, per `CLAUDE.md`).
- No new columns: the plan (including `eventId`) lives in the existing `response` JSONB.

## 7. Error handling

- One bad action never aborts the batch: unmatched refs → `unresolved[]`; service rejections (event-window/past/permission/foreign assignee) → `rejected[]` / silently skipped as already established.
- `confirm`/`cancel` on a missing, foreign, already-applied, cancelled, or expired request → `404` / `403` / `400` with a clear bilingual message (matching existing style).
- Non-array LLM output → `rejected` (existing "insufficient info" path), regardless of mode.

## 8. Testing

Extend `src/ai/ai.service.spec.ts` (keep the existing 13 green); construct the service with hand-rolled mock repos/services as the file already does:
- Each new action type resolves and routes to the right `TasksService` method (`remove`, `merge`, `addToGroup`, `renameGroup`, `ungroup`, `setAssignees([])`).
- `group` field: two creates sharing a `group` title end up linked into one group.
- Generative prompt path: a single goal message yielding many creates executes them all (mock returns an array of N creates).
- `mode: 'ask'` returns `status: 'pending_confirmation'` with a `plan` and **does not** call any mutating `TasksService` method; persists status `awaiting_confirmation`.
- `confirm` executes the stored plan and sets status `success`; `cancel` sets `cancelled`.
- Guards: confirm/cancel reject a foreign `user_id` (403), a non-`awaiting_confirmation` status (400), and an expired (>15 min) request (400).
- `delete` with an unmatched `task_ref` is skipped into `unresolved`, not thrown.
- Action cap: >40 actions are truncated and the overflow counted.
- **Clarification**: a model reply of `{ clarification_needed: true, question }` returns `status: 'needs_clarification'` with the `question`, persists status `needs_clarification`, and calls no mutating service; a follow-up call carrying `history` then yields actions. A `history` array is forwarded into the LLM `messages` in order.

E2E (`test/`) stays AI-inert (no outbound calls); the confirm/cancel guard logic is covered by unit tests.

## Open questions / assumptions

- Auto-assignment strategy is left to the model (spread sensibly across the roster); we don't impose a strict round-robin server-side.
- Admin/organizer-as-actor roster fallback (event staff) is a best-effort convenience; the primary user is a manager with owned staff.
