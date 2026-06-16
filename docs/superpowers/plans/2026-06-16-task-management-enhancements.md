# Task Management Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a filterable/sortable task list view, manager self-assignment, reusable per-event custom progress statuses, and symmetric task links (with linked-task visibility for staff) — with AI parity for managers/admin.

**Architecture:** Layer additively on the existing NestJS `TasksService` (controller → service → TypeORM repo) and the Next.js `/tasks` page. The real status lifecycle, cron, priority automation, undo change-log, and event-membership authorization are untouched; new behavior reuses `assertCanViewEvent`/`assertCanManageEvent`, the existing `update()` undo+broadcast path, and the existing AI action pipeline (`catalog → validate → resolve → service`).

**Tech Stack:** NestJS 11 + TypeORM (Postgres, `synchronize:false`, manual DDL + ordered SQL migrations), Jest (hand-rolled mock repos), Next.js 16 / React 19, axios `api` instance.

**Branch:** Work on `dev`. Run all commands from `event-ops-backend/` or `event-ops-frontend/`.

---

## Task 0: Branch setup

- [ ] **Step 1: Create/switch to dev branch from main**

```bash
git checkout main && git pull --ff-only 2>/dev/null; git checkout -B dev
```

- [ ] **Step 2: Confirm clean tree**

Run: `git status`
Expected: on branch `dev`, clean (the committed spec present).

---

## Task 1: DB schema — custom statuses table + tasks.custom_status_id (Feature 3)

**Files:**
- Modify: `database_creating.txt` (root) — add table + column (hand-sync canonical DDL)
- Create: `event-ops-backend/migrations/2026-06-16_custom_statuses.sql`

- [ ] **Step 1: Add the migration SQL** (idempotent, follows existing migration style)

Create `event-ops-backend/migrations/2026-06-16_custom_statuses.sql`:

```sql
-- Feature 3: reusable per-event custom progress statuses (display-only label,
-- layered on top of the real status lifecycle — automation never reads it).
CREATE TABLE IF NOT EXISTS task_custom_statuses (
  status_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  name        VARCHAR(60) NOT NULL,
  color       VARCHAR(20),
  created_by  UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS task_custom_statuses_event_name_uniq
  ON task_custom_statuses (event_id, lower(name));

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS custom_status_id UUID
  REFERENCES task_custom_statuses(status_id) ON DELETE SET NULL;
```

- [ ] **Step 2: Sync `database_creating.txt`** — add the same `Task_Custom_Statuses` table definition near the other task tables, and add `custom_status_id UUID` (FK, nullable) to the `Tasks` table block. Match the file's existing formatting/casing.

- [ ] **Step 3: Apply migration**

Run: `cd event-ops-backend && npm run db:migrate`
Expected: migration applies without error (idempotent on re-run).

- [ ] **Step 4: Commit**

```bash
git add database_creating.txt event-ops-backend/migrations/2026-06-16_custom_statuses.sql
git commit -m "feat(db): custom task statuses table + tasks.custom_status_id"
```

---

## Task 2: Entities — TaskCustomStatus, TaskDependency, Task.custom_status_id

**Files:**
- Create: `event-ops-backend/src/entities/task-custom-status.entity.ts`
- Create: `event-ops-backend/src/entities/task-dependency.entity.ts`
- Modify: `event-ops-backend/src/entities/task.entity.ts:44-45` (add field)
- Modify: `event-ops-backend/src/app.module.ts` (register both entities in `TypeOrmModule.forFeature` / root entities array)
- Modify: `event-ops-backend/src/tasks/tasks.module.ts` (add both to `TypeOrmModule.forFeature`)

- [ ] **Step 1: Create `task-custom-status.entity.ts`**

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('task_custom_statuses')
export class TaskCustomStatus {
  @PrimaryGeneratedColumn('uuid')
  status_id: string;

  @Column()
  event_id: string;

  @Column({ length: 60 })
  name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  color: string | null;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @CreateDateColumn()
  created_at: Date;
}
```

- [ ] **Step 2: Create `task-dependency.entity.ts`** (wires the dormant `task_dependencies` table)

```ts
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('task_dependencies')
export class TaskDependency {
  @PrimaryGeneratedColumn('uuid')
  dependency_id: string;

  @Column()
  task_id: string;

  @Column()
  depends_on_task: string;
}
```

- [ ] **Step 3: Add field to `task.entity.ts`** after `group_id` (line 45):

```ts
  // Optional reusable per-event custom progress label (display-only; not part of
  // the real status lifecycle the cron/AI drive).
  @Column({ type: 'uuid', nullable: true })
  custom_status_id: string | null;
```

- [ ] **Step 4: Register entities** in `app.module.ts` and `tasks/tasks.module.ts` `TypeOrmModule.forFeature([...])` arrays (add `TaskCustomStatus`, `TaskDependency`). Match how `Task`, `TaskGroup` are listed.

- [ ] **Step 5: Build to verify entity wiring**

Run: `cd event-ops-backend && npm run build`
Expected: compiles clean.

- [ ] **Step 6: Commit**

```bash
git add event-ops-backend/src/entities event-ops-backend/src/app.module.ts event-ops-backend/src/tasks/tasks.module.ts
git commit -m "feat(entities): TaskCustomStatus, TaskDependency, Task.custom_status_id"
```

---

## Task 3: Manager self-assign (Feature 2, backend)

**Files:**
- Modify: `event-ops-backend/src/tasks/tasks.service.ts:950-968` (`assertAssignable`)
- Test: `event-ops-backend/src/tasks/tasks.service.spec.ts` (add case; create spec if absent following the hand-rolled-mock pattern described in CLAUDE.md)

- [ ] **Step 1: Write the failing test** — a manager assigning *themselves* is allowed even though their role is not `staff`.

```ts
it('allows a manager to assign themselves', async () => {
  // userRepo.findOne returns the actor (a manager)
  userRepo.findOne = jest
    .fn()
    .mockResolvedValue({ user_id: 'mgr1', role: 'manager', manager_id: null });
  // assertAssignable is private — exercise via setAssignees with self id
  events.assertCanManageEvent = jest.fn().mockResolvedValue(undefined);
  await expect(
    service.setAssignees('task1', ['mgr1'], { sub: 'mgr1', role: 'manager' }),
  ).resolves.toBeDefined();
});
```

- [ ] **Step 2: Run it, expect FAIL** (`Tasks can only be assigned to staff members`)

Run: `cd event-ops-backend && npm test -- tasks.service`

- [ ] **Step 3: Relax `assertAssignable`** — permit the actor assigning themselves when actor is manager/admin:

```ts
  private async assertAssignable(
    userId: string,
    actor?: { sub: string; role: string },
  ) {
    const u = await this.userRepo.findOne({ where: { user_id: userId } });
    if (!u) {
      throw new NotFoundException('User not found / Không tìm thấy người dùng');
    }
    // A manager/admin may assign a task to themselves even though their role is
    // not 'staff' (self-assignment); otherwise only staff are assignable.
    const isSelf =
      actor && actor.sub === userId &&
      (actor.role === 'manager' || actor.role === 'admin');
    if (!isSelf && u.role !== 'staff') {
      throw new BadRequestException(
        'Tasks can only be assigned to staff members / Chỉ có thể giao công việc cho nhân viên',
      );
    }
    if (actor && actor.role === 'manager' && u.role === 'staff' && u.manager_id !== actor.sub) {
      throw new BadRequestException(
        'You can only assign your own staff / Bạn chỉ có thể giao cho nhân viên của mình',
      );
    }
  }
```

- [ ] **Step 4: Run test, expect PASS**

Run: `cd event-ops-backend && npm test -- tasks.service`

- [ ] **Step 5: Commit**

```bash
git add event-ops-backend/src/tasks
git commit -m "feat(tasks): allow managers to assign tasks to themselves"
```

---

## Task 4: Custom statuses — service + controller CRUD (Feature 3, backend)

**Files:**
- Modify: `event-ops-backend/src/tasks/tasks.service.ts` (inject `TaskCustomStatus` repo; add `listCustomStatuses`, `createCustomStatus`, `deleteCustomStatus`; include `custom_status_id` in the `findAllByEvent` returned objects — it's already on the entity so it's spread automatically)
- Modify: `event-ops-backend/src/tasks/tasks.controller.ts` (add 3 routes, declared **before** `@Get(':id')`)
- Modify: `event-ops-backend/src/tasks/dto/task.dto.ts` (add `CreateCustomStatusDto`; add optional `custom_status_id?: string | null` to `UpdateTaskDto`)
- Test: `tasks.service.spec.ts`

- [ ] **Step 1: Inject repo** — add to constructor:

```ts
    @InjectRepository(TaskCustomStatus)
    private customStatusRepo: Repository<TaskCustomStatus>,
```
and `import { TaskCustomStatus } from '../entities/task-custom-status.entity';`

- [ ] **Step 2: Write failing test** for create + list + duplicate rejection:

```ts
it('creates and lists a custom status for an event', async () => {
  events.assertCanViewEvent = jest.fn().mockResolvedValue(undefined);
  customStatusRepo.findOne = jest.fn().mockResolvedValue(null);
  customStatusRepo.create = jest.fn().mockImplementation((x) => x);
  customStatusRepo.save = jest.fn().mockImplementation(async (x) => ({ ...x, status_id: 's1' }));
  const made = await service.createCustomStatus('ev1', { name: 'Blocked', color: '#f00' }, { sub: 'u1', role: 'manager' });
  expect(made.status_id).toBe('s1');
});
```

- [ ] **Step 3: Run it, expect FAIL** (method undefined)

Run: `cd event-ops-backend && npm test -- tasks.service`

- [ ] **Step 4: Implement service methods** (place near the status helpers):

```ts
  // ── Custom statuses (reusable per-event progress labels) ────
  async listCustomStatuses(eventId: string, viewer: { sub: string; role: string }) {
    await this.events.assertCanViewEvent(viewer, eventId);
    return this.customStatusRepo.find({
      where: { event_id: eventId },
      order: { created_at: 'ASC' },
    });
  }

  async createCustomStatus(
    eventId: string,
    data: { name: string; color?: string | null },
    actor: { sub: string; role: string },
  ) {
    await this.events.assertCanViewEvent(actor, eventId);
    const name = (data.name ?? '').trim();
    if (!name) throw new BadRequestException('Status name required / Cần tên trạng thái');
    const existing = await this.customStatusRepo
      .createQueryBuilder('s')
      .where('s.event_id = :eventId', { eventId })
      .andWhere('lower(s.name) = lower(:name)', { name })
      .getOne();
    if (existing) throw new BadRequestException('Status already exists / Trạng thái đã tồn tại');
    const row = this.customStatusRepo.create({
      event_id: eventId,
      name,
      color: data.color ?? null,
      created_by: actor.sub,
    });
    const saved = await this.customStatusRepo.save(row);
    this.broadcastChange(eventId);
    return saved;
  }

  async deleteCustomStatus(statusId: string, actor: { sub: string; role: string }) {
    const row = await this.customStatusRepo.findOne({ where: { status_id: statusId } });
    if (!row) throw new NotFoundException('Status not found / Không tìm thấy trạng thái');
    // Creator can delete their own; otherwise must manage the event.
    if (row.created_by !== actor.sub) {
      await this.events.assertCanManageEvent(actor, row.event_id);
    } else {
      await this.events.assertCanViewEvent(actor, row.event_id);
    }
    await this.customStatusRepo.delete({ status_id: statusId }); // FK SET NULL detaches tasks
    this.broadcastChange(row.event_id);
    return { message: 'Custom status deleted' };
  }
```

- [ ] **Step 5: Add DTOs** in `dto/task.dto.ts`:

```ts
export class CreateCustomStatusDto {
  name: string;
  color?: string | null;
}
```
and add to `UpdateTaskDto`: `custom_status_id?: string | null;`

- [ ] **Step 6: Add controller routes** before `@Get(':id')` (so the literal segments aren't swallowed):

```ts
  @Get('event/:eventId/custom-statuses')
  listCustomStatuses(
    @Request() req: { user: JwtPayload },
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.tasksService.listCustomStatuses(eventId, {
      sub: req.user.sub, role: req.user.role,
    });
  }

  @Post('event/:eventId/custom-statuses')
  createCustomStatus(
    @Request() req: { user: JwtPayload },
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() body: CreateCustomStatusDto,
  ) {
    return this.tasksService.createCustomStatus(eventId, body, {
      sub: req.user.sub, role: req.user.role,
    });
  }

  @Delete('custom-statuses/:statusId')
  deleteCustomStatus(
    @Request() req: { user: JwtPayload },
    @Param('statusId', ParseUUIDPipe) statusId: string,
  ) {
    return this.tasksService.deleteCustomStatus(statusId, {
      sub: req.user.sub, role: req.user.role,
    });
  }
```
Add `CreateCustomStatusDto` to the dto import block. These routes carry no `@Roles` (any event member); authorization is enforced in the service.

- [ ] **Step 7: Allow `update()` to set `custom_status_id`** — confirm `tasks.service.ts update()` spreads arbitrary `Partial<Task>` fields into the saved entity (it does, via the controller's `data` object). The controller already forwards `rest`, so `custom_status_id` flows through and is captured by the existing change-log/undo + broadcast. No status-transition gate applies to it (only `status` triggers `assertStatusChangeAllowed`). Add a guard so only creator/assignee may set it — in `update()`, where `data.custom_status_id !== undefined`, call the existing creator/assignee check (reuse the logic from `assertStatusChangeAllowed` lines 893-904; extract a small private `assertCreatorOrAssignee(task, actor)` and call it from both).

- [ ] **Step 8: Run tests, expect PASS**

Run: `cd event-ops-backend && npm test -- tasks.service`

- [ ] **Step 9: Commit**

```bash
git add event-ops-backend/src/tasks
git commit -m "feat(tasks): custom status CRUD + set task custom_status_id"
```

---

## Task 5: Task links + linked-task visibility (Feature 4, backend)

**Files:**
- Modify: `event-ops-backend/src/tasks/tasks.service.ts` (inject `TaskDependency` repo; add `linkTasks`, `unlinkTasks`, `getLinks`; expand `findAllByEvent` staff filter to include linked tasks)
- Modify: `event-ops-backend/src/tasks/tasks.controller.ts` (3 routes before `@Get(':id')`)
- Modify: `event-ops-backend/src/tasks/dto/task.dto.ts` (`LinkTaskDto { target_task_id: string }`)
- Test: `tasks.service.spec.ts`

- [ ] **Step 1: Inject repo + import** `TaskDependency`:

```ts
    @InjectRepository(TaskDependency)
    private depRepo: Repository<TaskDependency>,
```

- [ ] **Step 2: Write failing test** — link rejected when tasks are in different events:

```ts
it('rejects linking tasks from different events', async () => {
  taskRepo.findOne = jest.fn()
    .mockResolvedValueOnce({ task_id: 'a', event_id: 'e1', created_by: 'u1' })
    .mockResolvedValueOnce({ task_id: 'b', event_id: 'e2', created_by: 'u1' });
  events.assertCanManageEvent = jest.fn().mockResolvedValue(undefined);
  await expect(
    service.linkTasks('a', 'b', { sub: 'u1', role: 'manager' }),
  ).rejects.toThrow();
});
```

- [ ] **Step 3: Run it, expect FAIL** (method undefined)

Run: `cd event-ops-backend && npm test -- tasks.service`

- [ ] **Step 4: Implement service methods**:

```ts
  // ── Task links (symmetric "related" relationship over task_dependencies) ──
  private async assertCanLink(task: Task, actor: { sub: string; role: string }) {
    // Managers/admin who manage the event, or staff who are creator/assignee.
    if (actor.role === 'manager' || actor.role === 'admin' || actor.role === 'organizer') {
      await this.events.assertCanManageEvent(actor, task.event_id);
      return;
    }
    await this.assertCreatorOrAssignee(task, actor); // shared helper from Task 4
  }

  async linkTasks(taskId: string, targetId: string, actor: { sub: string; role: string }) {
    if (taskId === targetId) throw new BadRequestException('Cannot link a task to itself');
    const a = await this.findOne(taskId);
    const b = await this.findOne(targetId);
    if (a.event_id !== b.event_id) {
      throw new BadRequestException('Tasks must be in the same event / Công việc phải cùng sự kiện');
    }
    await this.assertCanLink(a, actor);
    // Symmetric: skip if a link already exists in either direction.
    const exists = await this.depRepo
      .createQueryBuilder('d')
      .where('(d.task_id = :a AND d.depends_on_task = :b) OR (d.task_id = :b AND d.depends_on_task = :a)', { a: taskId, b: targetId })
      .getOne();
    if (!exists) {
      await this.depRepo.save(this.depRepo.create({ task_id: taskId, depends_on_task: targetId }));
    }
    this.broadcastChange(a.event_id);
    return { message: 'Linked' };
  }

  async unlinkTasks(taskId: string, targetId: string, actor: { sub: string; role: string }) {
    const a = await this.findOne(taskId);
    await this.assertCanLink(a, actor);
    await this.depRepo
      .createQueryBuilder()
      .delete()
      .where('(task_id = :a AND depends_on_task = :b) OR (task_id = :b AND depends_on_task = :a)', { a: taskId, b: targetId })
      .execute();
    this.broadcastChange(a.event_id);
    return { message: 'Unlinked' };
  }

  // The set of task ids linked (either direction) to the given task.
  private async linkedTaskIds(taskIds: string[]): Promise<Set<string>> {
    if (taskIds.length === 0) return new Set();
    const rows: Array<{ task_id: string; depends_on_task: string }> =
      await this.depRepo.manager.query(
        `SELECT task_id, depends_on_task FROM task_dependencies
         WHERE task_id = ANY($1::uuid[]) OR depends_on_task = ANY($1::uuid[])`,
        [taskIds],
      );
    const out = new Set<string>();
    for (const r of rows) { out.add(r.task_id); out.add(r.depends_on_task); }
    return out;
  }

  async getLinks(taskId: string, viewer: { sub: string; role: string }) {
    const task = await this.findOne(taskId);
    await this.events.assertCanViewEvent(viewer, task.event_id);
    const ids = await this.linkedTaskIds([taskId]);
    ids.delete(taskId);
    if (ids.size === 0) return [];
    return this.taskRepo.find({ where: { task_id: In(Array.from(ids)) } });
  }
```

- [ ] **Step 5: Expand staff visibility in `findAllByEvent`** (replace the staff filter at lines 80-86):

```ts
    if (viewer?.role === 'staff') {
      const mine = await this.assignRepo.find({ where: { user_id: viewer.sub } });
      const myTaskIds = mine.map((a) => a.task_id);
      const mySet = new Set(myTaskIds);
      // Also surface tasks linked to any of my assigned tasks (read-only).
      const linked = await this.linkedTaskIds(myTaskIds);
      tasks = tasks.filter((tk) => mySet.has(tk.task_id) || linked.has(tk.task_id));
    }
```

- [ ] **Step 6: Add DTO + controller routes** (before `@Get(':id')`):

```ts
  @Get(':id/links')
  getLinks(@Request() req: { user: JwtPayload }, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasksService.getLinks(id, { sub: req.user.sub, role: req.user.role });
  }

  @Post(':id/links')
  linkTask(@Request() req: { user: JwtPayload }, @Param('id', ParseUUIDPipe) id: string, @Body() body: LinkTaskDto) {
    return this.tasksService.linkTasks(id, body.target_task_id, { sub: req.user.sub, role: req.user.role });
  }

  @Delete(':id/links/:targetId')
  unlinkTask(@Request() req: { user: JwtPayload }, @Param('id', ParseUUIDPipe) id: string, @Param('targetId', ParseUUIDPipe) targetId: string) {
    return this.tasksService.unlinkTasks(id, targetId, { sub: req.user.sub, role: req.user.role });
  }
```
DTO in `task.dto.ts`: `export class LinkTaskDto { target_task_id: string; }`. No `@Roles` (managers + qualifying staff both allowed; service authorizes).

- [ ] **Step 7: Run tests, expect PASS**

Run: `cd event-ops-backend && npm test -- tasks.service`

- [ ] **Step 8: Commit**

```bash
git add event-ops-backend/src/tasks
git commit -m "feat(tasks): task links + linked-task visibility for staff"
```

---

## Task 6: AI parity — custom status, create_custom_status, link/unlink (Feature 3+4, AI)

**Files:**
- Modify: `event-ops-backend/src/ai/ai.types.ts` (add action kinds)
- Modify: `event-ops-backend/src/ai/ai.authz.ts` (`AI_ACTION_ROLES`: new actions → `manager`, `admin`)
- Modify: `event-ops-backend/src/ai/ai.catalog.ts:9-49` (`ACTION_SHAPES` entries)
- Modify: `event-ops-backend/src/ai/ai.validate.ts` (parse/coerce new actions; add `custom_status` to `update`)
- Modify: `event-ops-backend/src/ai/ai.resolve.ts` (resolve custom-status name→id within event; resolve target task ref)
- Modify: `event-ops-backend/src/ai/ai.service.ts` (execute new actions via `TasksService`; `update` handler maps `custom_status`)
- Test: `event-ops-backend/src/ai/*.spec.ts` (follow existing AI spec pattern)

- [ ] **Step 1: Add action kinds** to `ai.types.ts` `AiActionKind` union: `'create_custom_status' | 'link_tasks' | 'unlink_tasks'`. Extend the update action type with optional `custom_status?: string`.

- [ ] **Step 2: Gate roles** in `ai.authz.ts` `AI_ACTION_ROLES` — add each new kind mapped to `['manager', 'admin']` (matching other task-scoped actions).

- [ ] **Step 3: Add catalog shapes** to `ACTION_SHAPES` in `ai.catalog.ts`:

```ts
  create_custom_status:
    '{ "action": "create_custom_status", "name": "string", "color"?: "#hex", "event_ref"?: "event name or id" }',
  link_tasks:
    '{ "action": "link_tasks", "task_ref": "task name or id", "target_ref": "task name or id" }',
  unlink_tasks:
    '{ "action": "unlink_tasks", "task_ref": "task name or id", "target_ref": "task name or id" }',
```
And extend the `update` shape string to include `"custom_status"?: "custom status name"`.

- [ ] **Step 4: Write failing AI validate test** — `link_tasks` parses to a typed action. Run: `cd event-ops-backend && npm test -- ai`. Expect FAIL.

- [ ] **Step 5: Validate** in `ai.validate.ts` — accept the three new actions (require `task_ref`+`target_ref` for link/unlink; `name` for create_custom_status) and pass through `custom_status` on update, following the existing per-action coercion blocks.

- [ ] **Step 6: Resolve** in `ai.resolve.ts` — for `update.custom_status`, resolve by name within the task's event to a `custom_status_id`; if no match, set a structured rejection (resolve-or-reject, do not auto-create on update). For `create_custom_status`, resolve the event (default to the request's current event scope as other event actions do). For link/unlink, resolve both task refs by id/name within the event.

- [ ] **Step 7: Execute** in `ai.service.ts` — in the action dispatch switch, add cases calling `tasksService.createCustomStatus`, `tasksService.linkTasks`, `tasksService.unlinkTasks`; in the existing `update` handler (~line 720) set `patch.custom_status_id = resolvedId` when `custom_status` was provided. Reuse the existing actor (verified JWT) and event-scope plumbing.

- [ ] **Step 8: Run AI tests, expect PASS**

Run: `cd event-ops-backend && npm test -- ai`

- [ ] **Step 9: Full backend test + build**

Run: `cd event-ops-backend && npm test && npm run build`
Expected: all green, compiles.

- [ ] **Step 10: Commit**

```bash
git add event-ops-backend/src/ai
git commit -m "feat(ai): custom-status and task-link actions for managers/admin"
```

---

## Task 7: Frontend API helpers

**Files:**
- Modify: `event-ops-frontend/src/lib/api.ts` (extend `tasksApi`)

- [ ] **Step 1: Add helpers** to `tasksApi` in `api.ts` (match existing style):

```ts
  listCustomStatuses: (eventId: string) => api.get(`/tasks/event/${eventId}/custom-statuses`),
  createCustomStatus: (eventId: string, body: { name: string; color?: string | null }) =>
    api.post(`/tasks/event/${eventId}/custom-statuses`, body),
  deleteCustomStatus: (statusId: string) => api.delete(`/tasks/custom-statuses/${statusId}`),
  getLinks: (taskId: string) => api.get(`/tasks/${taskId}/links`),
  linkTask: (taskId: string, targetTaskId: string) =>
    api.post(`/tasks/${taskId}/links`, { target_task_id: targetTaskId }),
  unlinkTask: (taskId: string, targetId: string) =>
    api.delete(`/tasks/${taskId}/links/${targetId}`),
```

- [ ] **Step 2: Build check**

Run: `cd event-ops-frontend && npm run build` (or `npm run lint`)
Expected: no type errors from the new helpers.

- [ ] **Step 3: Commit**

```bash
git add event-ops-frontend/src/lib/api.ts
git commit -m "feat(web): api helpers for custom statuses and task links"
```

---

## Task 8: Frontend — list view toggle + sorting (Feature 1)

> **Before editing frontend code:** read the relevant guide in `event-ops-frontend/node_modules/next/dist/docs/` per the project's AGENTS.md (Next 16 / React 19).

**Files:**
- Modify: `event-ops-frontend/src/app/tasks/page.tsx` (add `viewMode` state, toggle button, list table, sort state)
- (Optional) Create: `event-ops-frontend/src/components/TaskList.tsx` if the page grows unwieldy — extract the table.

- [ ] **Step 1: Add state** near the existing filter state (`page.tsx:55-58`):

```tsx
const [viewMode, setViewMode] = useState<'timeline' | 'list'>('timeline');
const [sortKey, setSortKey] = useState<'priority' | 'deadline' | 'start' | 'name'>('priority');
const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
```

- [ ] **Step 2: Compute the sorted+filtered list** from the already-fetched tasks, reusing the existing `matches()` predicate, then sort by `sortKey`/`sortDir` (priority→`priority_score`, deadline/start→date, name→localeCompare).

- [ ] **Step 3: Add the toggle button** in the toolbar (Timeline ↔ List) and render either `<TaskTimeline …>` or the new table. Table columns: name, status, custom-status chip, priority, assignees (reuse avatar rendering), start, deadline, group_title. Clicking a row opens the same inline panel used by the timeline.

- [ ] **Step 4: Add sort controls** (dropdown for key + asc/desc toggle) visible in list mode.

- [ ] **Step 5: Manual verify** — `npm run dev`, open `/tasks`, toggle to List, confirm filter + each sort order. (No automated FE test infra in this repo; verify in the running app.)

- [ ] **Step 6: Commit**

```bash
git add event-ops-frontend/src/app/tasks/page.tsx event-ops-frontend/src/components
git commit -m "feat(web): task list view with filtering and sorting"
```

---

## Task 9: Frontend — manager self-assign in picker (Feature 2)

**Files:**
- Modify: `event-ops-frontend/src/app/tasks/page.tsx:67-69` (`assignableStaff`)

- [ ] **Step 1: Include the current manager** in the assignable list:

```tsx
const assignableStaff = useMemo(() => {
  const staff = teamMembers.filter(
    (m) => m.role === 'staff' && (isAdmin || m.manager_id === user?.user_id),
  );
  // A manager can also assign tasks to themselves.
  if (isManager && user && !staff.some((s) => s.user_id === user.user_id)) {
    return [{ ...user }, ...staff];
  }
  return staff;
}, [teamMembers, isAdmin, isManager, user]);
```
(Adjust to the existing shape — the current code is a non-memoized filter; keep whichever form is there, just add the self entry.)

- [ ] **Step 2: Manual verify** — open the assignee picker as a manager, confirm self appears and saves (backend already permits it).

- [ ] **Step 3: Commit**

```bash
git add event-ops-frontend/src/app/tasks/page.tsx
git commit -m "feat(web): managers can assign tasks to themselves"
```

---

## Task 10: Frontend — custom status UI (Feature 3)

**Files:**
- Modify: `event-ops-frontend/src/app/tasks/page.tsx` (load statuses per event; manage modal; dropdown on task; chip; list filter)
- (Optional) Create: `event-ops-frontend/src/components/CustomStatusManager.tsx`

- [ ] **Step 1: Fetch custom statuses** for the selected event (via `tasksApi.listCustomStatuses`) into state; refetch on `data_changed` (reuse `useLiveData`).

- [ ] **Step 2: Manage modal** — list existing statuses, add (name + optional color), delete. Wire to `createCustomStatus` / `deleteCustomStatus`.

- [ ] **Step 3: Per-task dropdown** — set/clear `custom_status_id` via `tasksApi.update(taskId, { custom_status_id })` (the existing update endpoint). Render the chosen status as a colored chip in list + timeline (`TaskTimeline.tsx` near the status color map).

- [ ] **Step 4: List filter** — add a "custom status" filter option to the list view, filtering on `task.custom_status_id`.

- [ ] **Step 5: Manual verify** — create a status, apply to a task, see the chip, filter by it, delete the status (chip clears).

- [ ] **Step 6: Commit**

```bash
git add event-ops-frontend/src/app event-ops-frontend/src/components
git commit -m "feat(web): custom task status management and display"
```

---

## Task 11: Frontend — task linking UI (Feature 4)

**Files:**
- Modify: `event-ops-frontend/src/app/tasks/page.tsx` (link/unlink in the inline panel; "linked to my tasks" list filter; read-only rendering for non-owned linked tasks)

- [ ] **Step 1: Links section** in the task inline panel — list current links (`tasksApi.getLinks`), add a link by picking another task in the same event, remove a link. Wire to `linkTask`/`unlinkTask`.

- [ ] **Step 2: List filter** — "linked to my tasks" toggle (a task is shown if it is linked to one of the viewer's assigned tasks). For staff, linked-but-not-assigned tasks render read-only (reuse the existing "can I edit this" gate — creator/assignee).

- [ ] **Step 3: Manual verify** — as a manager link two tasks; log in as a staffer assigned to one and confirm the linked task is now visible (read-only) and filterable.

- [ ] **Step 4: Commit**

```bash
git add event-ops-frontend/src/app event-ops-frontend/src/components
git commit -m "feat(web): task linking UI and linked-task filter"
```

---

## Task 12: Full verification, README sync, merge & deploy

- [ ] **Step 1: Backend full test + build**

Run: `cd event-ops-backend && npm test && npm run build`
Expected: all suites pass, compiles.

- [ ] **Step 2: Frontend build**

Run: `cd event-ops-frontend && npm run build`
Expected: builds clean.

- [ ] **Step 3: Sync README** — update endpoint/access tables in `README.md` to mention custom-status and link routes + the new list view (README is kept aligned with code per CLAUDE.md).

```bash
git add README.md && git commit -m "docs: README sync for task list view, custom statuses, links"
```

- [ ] **Step 4: Push dev**

```bash
git push -u origin dev
```

- [ ] **Step 5: Merge to main**

```bash
git checkout main && git merge --no-ff dev -m "merge: task management enhancements" && git push origin main
```

- [ ] **Step 6: Deploy to EC2** (per memory `aws-ec2-deployment.md`, live at http://3.106.222.90 via `deploy/`). On the server: pull main, `docker compose -f deploy/docker-compose.prod.yml build`, apply the new migration inside the API/DB, then `up -d`. **Confirm with the user before running deploy** (outward-facing, irreversible-ish) and confirm the migration runs against the prod DB.

---

## Notes for the executor
- Backend specs use **hand-rolled mock repos** (`jest.fn()` for `find`/`save`/`findOne`/`manager.query`, passed `as never`); mock `events.assertCan*` to resolve. No Nest DI container in unit specs.
- New controller routes with literal path segments **must be declared before `@Get(':id')`** or the param route swallows them.
- Custom status + link changes call `broadcastChange(eventId)` so connected clients refetch via `useLiveData`.
- Custom-status edits ride the existing `update()` path → already in the undo change-log; links are intentionally **not** undoable (scope cut).
