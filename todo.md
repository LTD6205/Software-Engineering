# TODO — Event Ops

Working notes on what was added, what's still missing, and dead code to review.
Last updated 2026-06-02.

## Notifications now implemented

All are in-app (saved to `notifications` + pushed live over WebSocket) and bilingual EN/VI.

**Events**
- Added to an event (on create) → every new member (the chosen managers + all their staff).
- Added to an existing event via the member editor → that manager + their staff.
- Removed from an event via the member editor → that manager + their staff.
- Event completed (all tasks done) → every member.
- Event deleted → everyone who was a member.

**Staff → manager reassignment** (3 parties each, professional wording)
- Request: old manager ("you requested to move …"), new manager ("… wants to move … into your team"), staff ("you are being moved …, pending approval"). Staff stays in the old manager's projects until approval.
- Accept: old manager ("… has moved to …'s team"), new manager ("you received …"), staff ("you are now in …'s team"). Membership flips automatically (staff leaves old projects, joins new).
- Reject: old manager ("… declined; they stay in your team"), target ("you declined …"), staff ("your move was declined; you stay …").

**Tasks**
- Assigned to a task → the staff member.
- Removed from a task → the staff member.

> Bug fixed along the way: deleting a task/event now also clears its `notifications`
> rows (the `notifications.task_id` FK was blocking deletes once task notifications existed).

## Missing / needs fixing

- [ ] **Deadline alerts don't reach managers.** The project brief says reminders/overdue
      alerts go to "both the assigned individuals **and** general event managers." The cron
      (`notifications.service.ts → sendNotification`) only notifies task assignees. It should
      also notify the event's member managers + event managers.
- [ ] **AI is create-only.** The brief wants natural-language commands to "recalculate
      milestones, reassign responsibilities, or restructure task lists dynamically."
      `ai.service.ts` only turns a prompt into new tasks — no update/reassign/restructure or
      milestone recalculation. Largest gap vs. the spec.
- [ ] **Milestones have no UI.** Entity, service, controller routes, and `tasksApi`
      helpers all exist, but nothing in the frontend shows/creates/completes milestones.
      Either build the UI or drop the feature.
- [ ] **Task dependencies are unused.** `task_dependencies` table + `TaskDependency` entity
      exist but no code reads/writes them. Needed if AI milestone recalculation is built;
      otherwise remove.
- [ ] **No "edit event" UI.** `PUT /events/:id` (+ `eventsApi.update`) exist but there's no
      way to edit an event's name/dates from the dashboard.
- [ ] **No "mark all read" / notification history.** Bell only lists unread and marks one at
      a time; read notifications are never shown again and never pruned (unbounded growth).
- [ ] **Owner can't cancel a pending reassignment.** Once requested, the Reassign button is
      hidden; there's no way to withdraw a pending request before the target acts.
- [ ] **Schema robustness:** give `notifications.task_id` an `ON DELETE SET NULL` (or CASCADE)
      FK so task deletion can't orphan/block on notifications without manual cleanup. Same idea
      for `task_assignments`/`milestones`/`task_logs` (currently deleted by hand in services).
- [ ] **New-task notification (optional):** notify an event's members when a task is added,
      not just when they're assigned to it.
- [ ] **Removing the last manager** leaves an event with 0 members (headcount 0); consider a
      guard or a clear empty-state.

## Unused / dead code to review (verify before deleting)

**Backend**
- `TasksService.findOverdue()` — no caller (the cron runs its own query). Dead.
- `TasksService` injects `depRepo` (`TaskDependency` repo) but never uses it. Dead injection
  (tied to the unused task-dependencies feature above).
- `POST /tasks/:id/assign` / `assignUser()` and `DELETE /tasks/:id/assign/:userId` /
  `unassignUser()` — the app now assigns exclusively through `PUT /tasks/:id/assignments`
  (`setAssignees`). Single assign/unassign endpoints are no longer called by the frontend.
- `GET /tasks/:id/assignments` / `getAssignments()` — not called by the frontend (the task
  list embeds assignees instead).
- `PUT /users/:id/deactivate` / `UsersService.deactivate()` — the Team page toggles active
  state via `usersApi.update({ is_active })`; this endpoint is unused.
- Milestone routes/methods (`getMilestones`, `addMilestone`, `completeMilestone`) — no UI
  consumes them (see "Milestones have no UI").

**Frontend (`src/lib/api.ts` helpers defined but never called)**
- `usersApi.deactivate`, `usersApi.getOne`
- `eventsApi.getOne`, `eventsApi.update`
- `tasksApi.getOne`, `tasksApi.assign`, `tasksApi.unassign`
- `tasksApi.getMilestones` / `addMilestone` / `completeMilestone` (no UI)
