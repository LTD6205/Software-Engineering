# AI Operations Partner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the AI Assistant into a role-aware operations partner (Admin/Organizer/Manager) that can perform any action its role allows across tasks/events/accounts, answer questions, plan generatively, ask for clarification, and run with an Auto-accept/Ask confirm toggle — accessed through a context-aware drawer instead of a standalone page.

**Architecture:** Approach A-extended. The model returns either a JSON array of actions, an `{answer}`, or a `{clarification_needed,question}`. `AiService` enforces a per-action **role allow-list** (controllers, not all services, hold the role gate), then routes each action through the existing `TasksService`/`EventsService`/`UsersService` with the actor's JWT (defense-in-depth membership/ownership checks remain). Ask mode persists the plan to `ai_requests` and applies it via a `confirm` endpoint. The frontend AI page is replaced by a global, route-aware slide-over drawer; live refresh reuses the existing `data_changed` broadcasts.

**Tech Stack:** NestJS 11, TypeORM (Postgres, `synchronize:false`), Jest, axios (OpenAI-compatible chat API), Next.js 16 / React 19, Socket.io.

**Spec:** `docs/superpowers/specs/2026-06-05-ai-manager-partner-design.md`

**Working rules:** Backend commands run from `event-ops-backend/`. Run a single suite with `npm test -- <filter>`. Frontend changes: read the relevant guide under `event-ops-frontend/node_modules/next/dist/docs/` first (per `CLAUDE.md`). Keep the existing 13 AI specs green throughout.

---

## File structure

**Backend**
- `migrations/2026-06-05_ai_request_confirmation_status.sql` — *create*. Widen `ai_requests.status` CHECK.
- `database_creating.txt` — *modify*. Mirror the widened CHECK.
- `src/ai/dto/ai-command.dto.ts` — *modify*. Add `mode`, `history`; make `eventId` optional.
- `src/ai/ai.types.ts` — *create*. Shared action/result/role types (keeps `ai.service.ts` focused).
- `src/ai/ai.authz.ts` — *create*. Pure role allow-list helper (`isActionAllowedForRole`) — unit-testable in isolation.
- `src/ai/ai.service.ts` — *modify*. New action validation, `executeActions`, role gate wiring, context block, prompt, modes, confirm/cancel, answer/clarification.
- `src/ai/ai.controller.ts` — *modify*. Open to `organizer/manager/admin`; add `confirm`/`cancel` routes.
- `src/ai/ai.module.ts` — *modify*. Import `UsersModule`; ensure `EventsModule`/`UsersModule` export their services.
- `src/users/users.module.ts` / `src/events/users` — *verify/modify* exports.

**Frontend**
- `src/app/ai/page.tsx` — *delete*.
- `src/components/Sidebar.tsx:29` — *modify*. Remove AI nav item.
- `src/components/AiDrawer.tsx` — *create*. The context-aware AI surface.
- `src/components/AppShell.tsx` — *modify*. Mount `<AiDrawer>` + launcher.
- `src/lib/api.ts` — *modify*. Add `aiApi` helpers (`command`, `confirm`, `cancel`).

---

# PHASE 0 — Database & wiring

### Task 0.1: Widen `ai_requests.status` CHECK (migration)

**Files:**
- Create: `event-ops-backend/migrations/2026-06-05_ai_request_confirmation_status.sql`
- Modify: `event-ops-backend/database_creating.txt` (the `ai_requests` CREATE TABLE CHECK)

- [ ] **Step 1: Write the migration**

```sql
-- Migration: allow AI confirmation + clarification statuses on ai_requests.
--
-- Why: the Ask/confirm flow stores a pending plan (awaiting_confirmation) that a
-- later /confirm applies or /cancel discards; the clarification loop records a
-- needs_clarification turn. The original CHECK only allowed
--   status IN ('pending','success','rejected')
-- so those rows could not be written. This widens the CHECK. ('answered' reuses
-- 'success'.)
--
-- Apply with:  npm run db:migrate   (or paste into pgAdmin)
-- Safe to run repeatedly: drops the existing status CHECK then recreates it.

ALTER TABLE ai_requests DROP CONSTRAINT IF EXISTS ai_requests_status_check;

ALTER TABLE ai_requests
  ADD CONSTRAINT ai_requests_status_check
  CHECK (status IN (
    'pending', 'success', 'rejected',
    'awaiting_confirmation', 'cancelled', 'needs_clarification'
  ));
```

- [ ] **Step 2: Apply and verify**

Run: `npm run db:migrate`
Then verify:
```bash
node -e "require('dotenv').config();const{Client}=require('pg');(async()=>{const c=new Client({host:process.env.DB_HOST,port:+process.env.DB_PORT||5432,user:process.env.DB_USERNAME,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});await c.connect();const r=await c.query(\"SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='ai_requests_status_check'\");console.log(r.rows[0].d);await c.end();})()"
```
Expected: the printed CHECK lists all six statuses.

- [ ] **Step 3: Mirror in `database_creating.txt`** — find the `ai_requests` table definition and update its `status` CHECK to the same six values, with a short comment.

- [ ] **Step 4: Commit**

```bash
git add migrations/2026-06-05_ai_request_confirmation_status.sql database_creating.txt
git commit -m "feat(ai): widen ai_requests.status for confirm/clarification flow"
```

### Task 0.2: Extend the command DTO

**Files:**
- Modify: `event-ops-backend/src/ai/dto/ai-command.dto.ts`

- [ ] **Step 1: Read the current DTO** to match its validation style (`class-validator` decorators).

- [ ] **Step 2: Update the DTO**

```typescript
import {
  IsOptional,
  IsString,
  IsUUID,
  IsIn,
  IsArray,
  ValidateNested,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AiHistoryTurnDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(4000)
  content: string;
}

export class AiCommandDto {
  // Optional: when present, the default event for task actions + the loaded
  // task context. Absent for cross-event commands ("create an event"…).
  @IsOptional()
  @IsUUID()
  eventId?: string;

  @IsString()
  @MaxLength(4000)
  message: string;

  @IsOptional()
  @IsIn(['auto', 'ask'])
  mode?: 'auto' | 'ask';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AiHistoryTurnDto)
  history?: AiHistoryTurnDto[];
}
```

- [ ] **Step 3: Build to verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/ai/dto/ai-command.dto.ts
git commit -m "feat(ai): add mode/history to AiCommandDto, make eventId optional"
```

### Task 0.3: Open the AI controller to all three roles + confirm/cancel routes

**Files:**
- Modify: `event-ops-backend/src/ai/ai.controller.ts`

- [ ] **Step 1: Replace the controller body**

```typescript
import {
  Controller,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/jwt.strategy';
import { AiCommandDto } from './dto/ai-command.dto';

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('command')
  @Roles('organizer', 'manager', 'admin')
  async processCommand(
    @Request() req: { user: JwtPayload },
    @Body() body: AiCommandDto,
  ): Promise<object> {
    return this.aiService.processCommand(
      { sub: req.user.sub, role: req.user.role },
      { eventId: body.eventId, message: body.message, mode: body.mode, history: body.history },
    );
  }

  @Post('command/:requestId/confirm')
  @Roles('organizer', 'manager', 'admin')
  async confirm(
    @Request() req: { user: JwtPayload },
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ): Promise<object> {
    return this.aiService.confirmCommand(
      { sub: req.user.sub, role: req.user.role },
      requestId,
    );
  }

  @Post('command/:requestId/cancel')
  @Roles('organizer', 'manager', 'admin')
  async cancel(
    @Request() req: { user: JwtPayload },
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ): Promise<object> {
    return this.aiService.cancelCommand(
      { sub: req.user.sub, role: req.user.role },
      requestId,
    );
  }
}
```

> Note: `processCommand` now takes an options object. Its signature is finalized in Phase 3; until then it will not compile against the old service. To keep phases independently buildable, implement Task 0.3 **together with Phase 1 Task 1.1** (which updates the service signature) in one commit, or stub the new service methods first. The recommended order is: do Task 1.1's signature change, then this task.

- [ ] **Step 2: Commit (with Task 1.1)** — see Task 1.1.

### Task 0.4: Wire `UsersService` into `AiModule`

**Files:**
- Modify: `event-ops-backend/src/ai/ai.module.ts`
- Verify/Modify: `event-ops-backend/src/users/users.module.ts` (must `exports: [UsersService]`)

- [ ] **Step 1: Confirm `UsersModule` exports `UsersService`.** Read `src/users/users.module.ts`; if `exports` is missing `UsersService`, add it.

- [ ] **Step 2: Import `UsersModule` in `AiModule`**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiRequest } from '../entities/ai-request.entity';
import { AiTaskMap } from '../entities/ai-task-map.entity';
import { User } from '../entities/user.entity';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { TasksModule } from '../tasks/tasks.module';
import { EventsModule } from '../events/events.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiRequest, AiTaskMap, User]),
    TasksModule,
    EventsModule,
    UsersModule,
  ],
  providers: [AiService],
  controllers: [AiController],
})
export class AiModule {}
```

- [ ] **Step 3: Build**

Run: `npx tsc --noEmit -p tsconfig.json` (expect errors only from the not-yet-updated `AiService` constructor — resolved in Phase 1; if doing phases in order, build after Task 1.1).

- [ ] **Step 4: Commit**

```bash
git add src/ai/ai.module.ts src/users/users.module.ts
git commit -m "feat(ai): import UsersModule into AiModule"
```

---

# PHASE 1 — Engine refactor: role gate + `executeActions` + new result buckets

This phase preserves today's create/update/reassign behavior but restructures the service so later phases drop in cleanly. Keep all 13 existing specs green.

### Task 1.1: Shared types + role allow-list (pure, unit-tested first)

**Files:**
- Create: `event-ops-backend/src/ai/ai.types.ts`
- Create: `event-ops-backend/src/ai/ai.authz.ts`
- Test: `event-ops-backend/src/ai/ai.authz.spec.ts`
- Modify: `src/ai/ai.service.ts` (signature only, in this task)

- [ ] **Step 1: Write the failing authz test**

```typescript
// src/ai/ai.authz.spec.ts
import { isActionAllowedForRole, AI_ACTION_ROLES } from './ai.authz';

describe('isActionAllowedForRole', () => {
  it('lets a manager do task actions but not event actions', () => {
    expect(isActionAllowedForRole('manager', 'create')).toBe(true);
    expect(isActionAllowedForRole('manager', 'delete')).toBe(true);
    expect(isActionAllowedForRole('manager', 'create_event')).toBe(false);
  });

  it('lets an organizer do event actions but not task actions', () => {
    expect(isActionAllowedForRole('organizer', 'create_event')).toBe(true);
    expect(isActionAllowedForRole('organizer', 'add_event_manager')).toBe(true);
    expect(isActionAllowedForRole('organizer', 'create')).toBe(false);
  });

  it('lets an admin do everything in the catalog', () => {
    for (const action of Object.keys(AI_ACTION_ROLES)) {
      expect(isActionAllowedForRole('admin', action)).toBe(true);
    }
  });

  it('denies an unknown action for everyone', () => {
    expect(isActionAllowedForRole('admin', 'nuke')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- ai.authz`
Expected: FAIL — cannot find module `./ai.authz`.

- [ ] **Step 3: Implement the types**

```typescript
// src/ai/ai.types.ts
export type Role = 'admin' | 'organizer' | 'manager' | 'staff';
export type Priority = 'low' | 'medium' | 'high';

export type AiActionKind =
  | 'create' | 'update' | 'reassign' | 'unassign' | 'delete'
  | 'merge' | 'add_to_group' | 'rename_group' | 'ungroup'
  | 'create_event' | 'update_event' | 'delete_event'
  | 'add_event_manager' | 'remove_event_manager'
  | 'create_user' | 'update_user' | 'reset_password'
  | 'request_reassign' | 'accept_reassign' | 'reject_reassign' | 'cancel_reassign';

export interface Actor { sub: string; role: string; }

export interface CommandOptions {
  eventId?: string;
  message: string;
  mode?: 'auto' | 'ask';
  history?: { role: 'user' | 'assistant'; content: string }[];
}

// Result buckets returned by executeActions().
export interface ExecResult {
  tasks_created: object[];
  tasks_updated: object[];
  tasks_reassigned: object[];
  tasks_deleted: { task_id: string; task_name: string }[];
  unassigned: { task_id: string; task_name: string }[];
  groups_changed: { action: string; group_id?: string; title?: string }[];
  events_changed: { action: string; event_id?: string; event_name?: string }[];
  users_changed: { action: string; user_id?: string; summary: string }[];
  unresolved: string[];
  rejected: { ref: string; reason: string }[];
  skipped: number;
}
```

- [ ] **Step 4: Implement the role allow-list**

```typescript
// src/ai/ai.authz.ts
import { AiActionKind } from './ai.types';

// Which roles may perform each action, mirroring the controllers' @Roles
// (admin is the superuser and appears on every entry). This is a HARD gate in
// AiService — not all services self-enforce role (see spec Safety model).
export const AI_ACTION_ROLES: Record<AiActionKind, string[]> = {
  create: ['manager', 'admin'],
  update: ['manager', 'admin'],
  reassign: ['manager', 'admin'],
  unassign: ['manager', 'admin'],
  delete: ['manager', 'admin'],
  merge: ['manager', 'admin'],
  add_to_group: ['manager', 'admin'],
  rename_group: ['manager', 'admin'],
  ungroup: ['manager', 'admin'],
  create_event: ['organizer', 'admin'],
  update_event: ['organizer', 'admin'],
  delete_event: ['organizer', 'admin'],
  add_event_manager: ['organizer', 'admin'],
  remove_event_manager: ['organizer', 'admin'],
  create_user: ['manager', 'admin'],
  update_user: ['manager', 'admin'],
  reset_password: ['admin'],
  request_reassign: ['manager', 'admin'],
  accept_reassign: ['manager', 'admin'],
  reject_reassign: ['manager', 'admin'],
  cancel_reassign: ['manager', 'admin'],
};

export function isActionAllowedForRole(role: string, action: string): boolean {
  const roles = (AI_ACTION_ROLES as Record<string, string[]>)[action];
  return !!roles && roles.includes(role);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- ai.authz`
Expected: PASS (4 tests).

- [ ] **Step 6: Change `processCommand` signature in `ai.service.ts`** to accept the options object, keeping today's behavior. Replace the method header and the three call-site reads:

```typescript
// import at top:
import { CommandOptions, Actor } from './ai.types';

// signature:
async processCommand(actor: Actor, opts: CommandOptions): Promise<object> {
  const { eventId, message: userMessage } = opts;
  // …existing body unchanged for now (mode/history used in Phase 3)…
}
```
Add temporary stubs so the controller (Task 0.3) compiles:
```typescript
async confirmCommand(_actor: Actor, _requestId: string): Promise<object> {
  throw new Error('not implemented'); // Phase 3
}
async cancelCommand(_actor: Actor, _requestId: string): Promise<object> {
  throw new Error('not implemented'); // Phase 3
}
```

- [ ] **Step 7: Update the existing spec call sites.** In `ai.service.spec.ts`, change every `service.processCommand(ACTOR, 'e1', 'msg')` to `service.processCommand(ACTOR, { eventId: 'e1', message: 'msg' })`.

- [ ] **Step 8: Build + run AI specs (incl. Task 0.3/0.4 changes)**

Run: `npx tsc --noEmit -p tsconfig.json && npm test -- ai.service.spec && npm test -- ai.authz`
Expected: compiles; 13 + 4 tests PASS.

- [ ] **Step 9: Commit (Tasks 0.3, 0.4, 1.1 together)**

```bash
git add src/ai/ src/users/users.module.ts
git commit -m "feat(ai): role allow-list + options-object command signature; open controller to 3 roles"
```

### Task 1.2: Extract `executeActions` and add new result buckets (behavior-preserving)

**Files:**
- Modify: `event-ops-backend/src/ai/ai.service.ts`
- Test: `event-ops-backend/src/ai/ai.service.spec.ts`

- [ ] **Step 1: Add a test asserting the success response now carries the new (empty) buckets**

```typescript
it('returns the full set of result buckets on success', async () => {
  const { service, userRepo } = build();
  userRepo.findOne.mockResolvedValue(null);
  mockedAxios.post.mockResolvedValue(
    deepSeekReply(JSON.stringify([{ task_name: 'A', priority: 'low' }])),
  );
  const r = (await service.processCommand(ACTOR, { eventId: 'e1', message: 'x' })) as any;
  expect(r.status).toBe('success');
  for (const key of ['tasks_created','tasks_updated','tasks_reassigned','tasks_deleted','unassigned','groups_changed','events_changed','users_changed','unresolved','rejected','skipped']) {
    expect(r).toHaveProperty(key);
  }
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- ai.service.spec -t "full set of result buckets"`
Expected: FAIL (missing properties).

- [ ] **Step 3: Refactor.** Extract the per-action `for` loop into a private method that returns an `ExecResult`, and have the auto path call it. The role gate is applied per item (skip disallowed into `rejected`). Replace the execution section of `processCommand` with:

```typescript
import { ExecResult, AiActionKind } from './ai.types';
import { isActionAllowedForRole } from './ai.authz';

private emptyResult(): ExecResult {
  return {
    tasks_created: [], tasks_updated: [], tasks_reassigned: [], tasks_deleted: [],
    unassigned: [], groups_changed: [], events_changed: [], users_changed: [],
    unresolved: [], rejected: [], skipped: 0,
  };
}

// Single execution path for both the auto run and confirm. `currentTasks` is the
// resolvable task list (mutated as creates land); `defaultEventId` is the request
// event used when an action omits event_ref.
private async executeActions(
  actions: AiAction[],
  currentTasks: TaskRef[],
  defaultEventId: string | undefined,
  actor: Actor,
  aiRequestId: string,
): Promise<ExecResult> {
  const res = this.emptyResult();
  for (const item of actions) {
    if (!isActionAllowedForRole(actor.role, (item as { action: AiActionKind }).action)) {
      res.rejected.push({
        ref: (item as { task_ref?: string }).task_ref ?? (item as { task_name?: string }).task_name ?? item.action,
        reason: `Your role (${actor.role}) cannot perform "${item.action}"`,
      });
      continue;
    }
    await this.runAction(item, currentTasks, defaultEventId, actor, aiRequestId, res);
  }
  return res;
}
```

Move today's create/update/reassign handling into a new `runAction(item, currentTasks, defaultEventId, actor, aiRequestId, res)` switch, writing into `res.*` instead of local arrays (creates → `res.tasks_created`, updates → `res.tasks_updated`, reassign → `res.tasks_reassigned`, the create-failure try/catch → `res.rejected`, unmatched refs → `res.unresolved`). For `create`, use `item.event_ref`-resolved id or `defaultEventId` for `event_id`. Then in `processCommand`, replace the old loop and return with:

```typescript
const result = await this.executeActions(actions, currentTasks, eventId, actor, aiRequest.request_id);
await this.aiRequestRepo.update(aiRequest.request_id, { response: parsed, status: 'success' });
return { status: 'success', ...result };
```

- [ ] **Step 4: Run AI specs**

Run: `npm test -- ai.service.spec`
Expected: 13 existing + 1 new = 14 PASS. (Existing tests that asserted `tasks_created`/`unresolved`/`skipped` still pass — same keys.)

- [ ] **Step 5: Commit**

```bash
git add src/ai/ai.service.ts src/ai/ai.service.spec.ts
git commit -m "refactor(ai): extract executeActions with role gate + full result buckets"
```

---

# PHASE 2 — Full task actions

Add `unassign`, `delete`, `merge`, `add_to_group`, `rename_group`, `ungroup`, and the `group` field on `create`. Each routes to an existing `TasksService` method with the actor; unmatched refs → `unresolved`; service rejections → `rejected`.

### Task 2.1: Group context + `resolveGroupRef`

**Files:**
- Modify: `event-ops-backend/src/ai/ai.service.ts`
- Test: `event-ops-backend/src/ai/ai.service.spec.ts`

- [ ] **Step 1: Test resolution** — assert that when `findAllByEvent` returns tasks carrying `group_id`/`group_title`, a `rename_group` action targeting a group title routes to `tasksService.renameGroup(group_id, title, actor)`.

```typescript
it('rename_group resolves a group by title and calls renameGroup', async () => {
  const { service, tasksService } = build();
  tasksService.findAllByEvent.mockResolvedValue([
    { task_id: 't1', task_name: 'A', group_id: 'g1', group_title: 'Catering' },
  ]);
  mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify([
    { action: 'rename_group', group_ref: 'Catering', title: 'Food' },
  ])));
  await service.processCommand(ACTOR, { eventId: 'e1', message: 'rename catering to food' });
  expect(tasksService.renameGroup).toHaveBeenCalledWith('g1', 'Food', expect.objectContaining({ sub: 'u1' }));
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm test -- ai.service.spec -t "rename_group"`
Expected: FAIL.

- [ ] **Step 3: Build the group map + resolver.** Where `currentTasks` is built from `findAllByEvent`, also collect groups:

```typescript
// after building currentTasks from findAllByEvent results `rows`:
const groupByTitle = new Map<string, string>(); // lower(title) -> group_id
const groupIds = new Set<string>();
for (const t of rows as Array<{ group_id?: string; group_title?: string }>) {
  if (t.group_id) {
    groupIds.add(t.group_id);
    if (t.group_title) groupByTitle.set(t.group_title.trim().toLowerCase(), t.group_id);
  }
}
```
Add the resolver:
```typescript
private resolveGroupRef(
  ref: string,
  groupIds: Set<string>,
  groupByTitle: Map<string, string>,
): string | null {
  const needle = ref.trim().toLowerCase();
  if (groupIds.has(ref)) return ref;
  return groupByTitle.get(needle) ?? null;
}
```
Pass `groupIds`/`groupByTitle` into `executeActions`/`runAction` (add params).

- [ ] **Step 4: Run to verify pass** — `npm test -- ai.service.spec -t "rename_group"` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/ai.service.ts src/ai/ai.service.spec.ts
git commit -m "feat(ai): event group context + resolveGroupRef"
```

### Task 2.2: Implement the six new task actions in `runAction`

**Files:**
- Modify: `event-ops-backend/src/ai/ai.service.ts`
- Modify: `event-ops-backend/src/ai/ai.service.spec.ts` (mocks: add `remove`, `merge`, `addToGroup`, `ungroup`, plus the existing `setAssignees`/`renameGroup`)

- [ ] **Step 1: Extend `validateActions`** to recognize the new action strings and build typed objects (drop malformed into `skipped`). Add interfaces in `ai.types.ts`:

```typescript
export interface UnassignAction { action: 'unassign'; task_ref: string; }
export interface DeleteAction { action: 'delete'; task_ref: string; }
export interface MergeAction { action: 'merge'; task_ref: string; target_ref: string; }
export interface AddToGroupAction { action: 'add_to_group'; group_ref: string; task_ref: string; }
export interface RenameGroupAction { action: 'rename_group'; group_ref: string; title: string; }
export interface UngroupAction { action: 'ungroup'; task_ref: string; }
```
and add them to the `AiAction` union. In `validateActions`, for each new `action` value, require its refs (`task_ref`/`target_ref`/`group_ref`/`title`) non-empty else `skipped++`. Also add an optional `group?: string` to `CreateAction` and copy it through (`item.group` if a non-empty string).

- [ ] **Step 2: Write tests for each action** (one `it` each), e.g.:

```typescript
it('delete resolves a task and calls remove; unmatched ref → unresolved', async () => {
  const { service, tasksService } = build();
  tasksService.findAllByEvent.mockResolvedValue([{ task_id: 't1', task_name: 'A' }]);
  tasksService.remove = jest.fn().mockResolvedValue(undefined);
  mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify([
    { action: 'delete', task_ref: 'A' },
    { action: 'delete', task_ref: 'ghost' },
  ])));
  const r = (await service.processCommand(ACTOR, { eventId: 'e1', message: 'delete A and ghost' })) as any;
  expect(tasksService.remove).toHaveBeenCalledWith('t1', expect.objectContaining({ sub: 'u1' }));
  expect(r.tasks_deleted).toEqual([{ task_id: 't1', task_name: 'A' }]);
  expect(r.unresolved).toContain('ghost');
});

it('unassign clears assignees via setAssignees([])', async () => {
  const { service, tasksService } = build();
  tasksService.findAllByEvent.mockResolvedValue([{ task_id: 't1', task_name: 'A' }]);
  mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify([{ action: 'unassign', task_ref: 'A' }])));
  const r = (await service.processCommand(ACTOR, { eventId: 'e1', message: 'unassign A' })) as any;
  expect(tasksService.setAssignees).toHaveBeenCalledWith('t1', [], expect.anything());
  expect(r.unassigned).toEqual([{ task_id: 't1', task_name: 'A' }]);
});

it('merge resolves source+target and calls merge', async () => {
  const { service, tasksService } = build();
  tasksService.findAllByEvent.mockResolvedValue([
    { task_id: 't1', task_name: 'A' }, { task_id: 't2', task_name: 'B' },
  ]);
  tasksService.merge = jest.fn().mockResolvedValue({ group_id: 'g1' });
  mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify([
    { action: 'merge', task_ref: 'A', target_ref: 'B' },
  ])));
  const r = (await service.processCommand(ACTOR, { eventId: 'e1', message: 'merge A into B' })) as any;
  expect(tasksService.merge).toHaveBeenCalledWith('t1', 't2', expect.anything());
  expect(r.groups_changed[0]).toMatchObject({ action: 'merge', group_id: 'g1' });
});
```
(Add equivalent `it`s for `add_to_group`, `ungroup`.)

- [ ] **Step 3: Run to confirm failures** — `npm test -- ai.service.spec` → the new tests FAIL.

- [ ] **Step 4: Implement the handlers in `runAction`** (each wrapped so a service throw → `res.rejected`):

```typescript
case 'unassign': {
  const t = this.resolveTaskRef(item.task_ref, currentTasks);
  if (!t) { res.unresolved.push(item.task_ref); break; }
  try {
    await this.tasksService.setAssignees(t.task_id, [], actor);
    res.unassigned.push({ task_id: t.task_id, task_name: t.task_name });
  } catch (e) { res.rejected.push({ ref: item.task_ref, reason: this.reason(e) }); }
  break;
}
case 'delete': {
  const t = this.resolveTaskRef(item.task_ref, currentTasks);
  if (!t) { res.unresolved.push(item.task_ref); break; }
  try {
    await this.tasksService.remove(t.task_id, actor);
    res.tasks_deleted.push({ task_id: t.task_id, task_name: t.task_name });
  } catch (e) { res.rejected.push({ ref: item.task_ref, reason: this.reason(e) }); }
  break;
}
case 'merge': {
  const s = this.resolveTaskRef(item.task_ref, currentTasks);
  const tg = this.resolveTaskRef(item.target_ref, currentTasks);
  if (!s || !tg) { res.unresolved.push(!s ? item.task_ref : item.target_ref); break; }
  try {
    const g = await this.tasksService.merge(s.task_id, tg.task_id, actor);
    res.groups_changed.push({ action: 'merge', group_id: (g as { group_id?: string }).group_id });
  } catch (e) { res.rejected.push({ ref: item.task_ref, reason: this.reason(e) }); }
  break;
}
case 'add_to_group': {
  const gid = this.resolveGroupRef(item.group_ref, groupIds, groupByTitle);
  const t = this.resolveTaskRef(item.task_ref, currentTasks);
  if (!gid || !t) { res.unresolved.push(!gid ? item.group_ref : item.task_ref); break; }
  try {
    await this.tasksService.addToGroup(gid, t.task_id, actor);
    res.groups_changed.push({ action: 'add_to_group', group_id: gid });
  } catch (e) { res.rejected.push({ ref: item.task_ref, reason: this.reason(e) }); }
  break;
}
case 'rename_group': {
  const gid = this.resolveGroupRef(item.group_ref, groupIds, groupByTitle);
  if (!gid) { res.unresolved.push(item.group_ref); break; }
  try {
    await this.tasksService.renameGroup(gid, item.title, actor);
    res.groups_changed.push({ action: 'rename_group', group_id: gid, title: item.title });
  } catch (e) { res.rejected.push({ ref: item.group_ref, reason: this.reason(e) }); }
  break;
}
case 'ungroup': {
  const t = this.resolveTaskRef(item.task_ref, currentTasks);
  if (!t) { res.unresolved.push(item.task_ref); break; }
  try {
    await this.tasksService.ungroup(t.task_id, actor);
    res.groups_changed.push({ action: 'ungroup' });
  } catch (e) { res.rejected.push({ ref: item.task_ref, reason: this.reason(e) }); }
  break;
}
```
Add the shared helper:
```typescript
private reason(e: unknown): string {
  return e instanceof HttpException
    ? ((e.getResponse() as { message?: string }).message || e.message)
    : 'Action failed';
}
```

- [ ] **Step 5: Run AI specs** — `npm test -- ai.service.spec` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ai/
git commit -m "feat(ai): unassign/delete/merge/add_to_group/rename_group/ungroup task actions"
```

### Task 2.3: `group` field — link same-titled new tasks into one group

**Files:**
- Modify: `event-ops-backend/src/ai/ai.service.ts`
- Test: `event-ops-backend/src/ai/ai.service.spec.ts`

- [ ] **Step 1: Test** — two `create`s sharing `group: 'Setup'` cause one `merge` (link) call after both are created:

```typescript
it('links two same-group creates into one group', async () => {
  const { service, tasksService } = build();
  let n = 0;
  tasksService.create = jest.fn().mockImplementation(async () => ({ task_id: 'tk' + ++n, task_name: 'T' + n }));
  tasksService.merge = jest.fn().mockResolvedValue({ group_id: 'g1' });
  tasksService.findAllByEvent.mockResolvedValue([]);
  mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify([
    { task_name: 'Buy cake', priority: 'low', group: 'Food' },
    { task_name: 'Order pizza', priority: 'low', group: 'Food' },
  ])));
  const r = (await service.processCommand(ACTOR, { eventId: 'e1', message: 'plan food' })) as any;
  expect(tasksService.create).toHaveBeenCalledTimes(2);
  expect(tasksService.merge).toHaveBeenCalledWith('tk1', 'tk2', expect.anything());
  expect(r.tasks_created).toHaveLength(2);
});
```

- [ ] **Step 2: Run to confirm fail** — `npm test -- ai.service.spec -t "same-group"` → FAIL.

- [ ] **Step 3: Implement grouping.** In `runAction`'s `create` case, after a successful create, record `{ task_id, group }` when `item.group` is set. After the loop in `executeActions`, link groups:

```typescript
// In create case, on success, when item.group is a non-empty string:
if (item.group && item.group.trim()) {
  createdGroups.push({ taskId: task.task_id, title: item.group.trim() });
}
// `createdGroups: { taskId: string; title: string }[]` is declared in executeActions
// and passed into runAction (or collected on `res` via a private field).
```
After the action loop in `executeActions`:
```typescript
// Link newly-created tasks that share a group title. Reuse an existing event
// group with that title if present, else chain members via merge (the first
// pair creates the group; subsequent members add to it).
const byTitle = new Map<string, string[]>();
for (const g of createdGroups) {
  const arr = byTitle.get(g.title.toLowerCase()) ?? [];
  arr.push(g.taskId);
  byTitle.set(g.title.toLowerCase(), arr);
}
for (const [title, taskIds] of byTitle) {
  const existing = groupByTitle.get(title);
  try {
    if (existing) {
      for (const id of taskIds) await this.tasksService.addToGroup(existing, id, actor);
      res.groups_changed.push({ action: 'add_to_group', group_id: existing, title });
    } else if (taskIds.length >= 2) {
      const g = await this.tasksService.merge(taskIds[0], taskIds[1], actor);
      const gid = (g as { group_id?: string }).group_id;
      for (const id of taskIds.slice(2)) if (gid) await this.tasksService.addToGroup(gid, id, actor);
      res.groups_changed.push({ action: 'merge', group_id: gid, title });
    }
  } catch (e) { res.rejected.push({ ref: title, reason: this.reason(e) }); }
}
```

- [ ] **Step 4: Run AI specs** — `npm test -- ai.service.spec` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/
git commit -m "feat(ai): create.group field links new tasks into one group"
```

---

# PHASE 3 — Modes, history, answer, clarification, confirm/cancel

### Task 3.1: Forward `history` into the LLM messages

**Files:**
- Modify: `event-ops-backend/src/ai/ai.service.ts`
- Test: `event-ops-backend/src/ai/ai.service.spec.ts`

- [ ] **Step 1: Test** — `history` turns appear in the axios `messages` array between system and the latest user message:

```typescript
it('forwards history into the chat messages in order', async () => {
  const { service } = build();
  mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify([])));
  await service.processCommand(ACTOR, {
    eventId: 'e1', message: 'the gala',
    history: [{ role: 'user', content: 'reschedule it' }, { role: 'assistant', content: 'Which event?' }],
  });
  const body = mockedAxios.post.mock.calls[0][1] as { messages: { role: string; content: string }[] };
  const roles = body.messages.map((m) => m.role);
  expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
  expect(body.messages[3].content).toBe('the gala');
});
```

- [ ] **Step 2: Run to confirm fail** — FAIL (history ignored).

- [ ] **Step 3: Implement.** Build the messages array from history:

```typescript
const messages = [
  { role: 'system', content: systemPrompt },
  ...(opts.history ?? []).map((h) => ({ role: h.role, content: h.content })),
  { role: 'user', content: userMessage },
];
// pass `messages` to axios.post body instead of the inline two-message array.
```

- [ ] **Step 4: Run AI specs** → PASS. **Commit:** `feat(ai): forward conversation history to the model`.

### Task 3.2: `answer` and `clarification` responses

**Files:**
- Modify: `event-ops-backend/src/ai/ai.service.ts`
- Test: `event-ops-backend/src/ai/ai.service.spec.ts`

- [ ] **Step 1: Tests**

```typescript
it('returns an answer when the model replies with {answer}', async () => {
  const { service, tasksService } = build();
  mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify({ answer: '2 tasks overdue.' })));
  const r = (await service.processCommand(ACTOR, { eventId: 'e1', message: 'what is overdue?' })) as any;
  expect(r).toEqual({ status: 'answered', answer: '2 tasks overdue.' });
  expect(tasksService.create).not.toHaveBeenCalled();
});

it('returns a clarification question when the model asks back', async () => {
  const { service } = build();
  mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify({ clarification_needed: true, question: 'Which event?' })));
  const r = (await service.processCommand(ACTOR, { message: 'reschedule it' })) as any;
  expect(r.status).toBe('needs_clarification');
  expect(r.question).toBe('Which event?');
  expect(r.request_id).toBeDefined();
});
```

- [ ] **Step 2: Run to confirm fail** — FAIL.

- [ ] **Step 3: Implement.** After parsing `parsed`, before the `Array.isArray` branch:

```typescript
if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.answer === 'string') {
    await this.aiRequestRepo.update(aiRequest.request_id, { response: parsed as object, status: 'success' });
    return { status: 'answered', answer: obj.answer };
  }
  if (obj.clarification_needed === true && typeof obj.question === 'string') {
    await this.aiRequestRepo.update(aiRequest.request_id, { response: parsed as object, status: 'needs_clarification' });
    return { status: 'needs_clarification', request_id: aiRequest.request_id, question: obj.question };
  }
  // else: existing "rejected / insufficient info" path
}
```

- [ ] **Step 4: Run AI specs** → PASS. **Commit:** `feat(ai): answer + clarification response types`.

### Task 3.3: Ask mode persists a plan; `confirm`/`cancel` apply or discard

**Files:**
- Modify: `event-ops-backend/src/ai/ai.service.ts`
- Test: `event-ops-backend/src/ai/ai.service.spec.ts` (add `aiRequestRepo.findOne` mock)

- [ ] **Step 1: Tests**

```typescript
it('ask mode persists a plan and executes nothing', async () => {
  const { service, tasksService, aiRequestRepo } = build();
  mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify([{ task_name: 'A', priority: 'low' }])));
  const r = (await service.processCommand(ACTOR, { eventId: 'e1', message: 'add A', mode: 'ask' })) as any;
  expect(r.status).toBe('pending_confirmation');
  expect(r.request_id).toBe('req1');
  expect(Array.isArray(r.plan)).toBe(true);
  expect(tasksService.create).not.toHaveBeenCalled();
  expect(aiRequestRepo.update).toHaveBeenCalledWith('req1', expect.objectContaining({ status: 'awaiting_confirmation' }));
});

it('confirm executes a stored plan owned by the actor', async () => {
  const { service, tasksService, aiRequestRepo } = build();
  aiRequestRepo.findOne = jest.fn().mockResolvedValue({
    request_id: 'req1', user_id: 'u1', status: 'awaiting_confirmation',
    created_at: new Date(), response: { plan: [{ action: 'create', task_name: 'A', priority: 'low', assigned_to: '', deadline: '' }], eventId: 'e1' },
  });
  const r = (await service.confirmCommand(ACTOR, 'req1')) as any;
  expect(tasksService.create).toHaveBeenCalled();
  expect(r.status).toBe('success');
});

it('confirm rejects a foreign request (403) and an expired one (400)', async () => {
  const { service, aiRequestRepo } = build();
  aiRequestRepo.findOne = jest.fn().mockResolvedValue({ request_id: 'req1', user_id: 'someone-else', status: 'awaiting_confirmation', created_at: new Date(), response: { plan: [], eventId: 'e1' } });
  await expect(service.confirmCommand(ACTOR, 'req1')).rejects.toThrow(/permission|forbidden/i);
  aiRequestRepo.findOne = jest.fn().mockResolvedValue({ request_id: 'req1', user_id: 'u1', status: 'awaiting_confirmation', created_at: new Date(Date.now() - 16 * 60 * 1000), response: { plan: [], eventId: 'e1' } });
  await expect(service.confirmCommand(ACTOR, 'req1')).rejects.toThrow(/expired/i);
});

it('cancel marks the request cancelled', async () => {
  const { service, aiRequestRepo } = build();
  aiRequestRepo.findOne = jest.fn().mockResolvedValue({ request_id: 'req1', user_id: 'u1', status: 'awaiting_confirmation', created_at: new Date(), response: { plan: [], eventId: 'e1' } });
  const r = (await service.cancelCommand(ACTOR, 'req1')) as any;
  expect(r.status).toBe('cancelled');
  expect(aiRequestRepo.update).toHaveBeenCalledWith('req1', { status: 'cancelled' });
});
```

- [ ] **Step 2: Run to confirm fail** — FAIL (`confirmCommand` throws "not implemented").

- [ ] **Step 3: Implement ask-mode branch** in `processCommand` (after `validateActions`, before auto-exec):

```typescript
if (opts.mode === 'ask') {
  const plan = this.describePlan(actions, currentTasks, groupIds, groupByTitle);
  await this.aiRequestRepo.update(aiRequest.request_id, {
    response: { plan: actions, eventId, descriptions: plan } as object,
    status: 'awaiting_confirmation',
  });
  return {
    status: 'pending_confirmation',
    request_id: aiRequest.request_id,
    plan,
    unresolved: [],
    skipped,
  };
}
```
Add `describePlan(...)` returning `{ kind, description }[]` — a human line per action (e.g. `Delete task "A"`, `Create "Buy cake"`, `Merge "A" into "B"`). Implement `confirm`/`cancel`:

```typescript
private static readonly CONFIRM_TTL_MS = 15 * 60 * 1000;

async confirmCommand(actor: Actor, requestId: string): Promise<object> {
  const reqRow = await this.loadPending(actor, requestId);
  const stored = reqRow.response as { plan: AiAction[]; eventId?: string };
  const currentTasks: TaskRef[] = ((await this.tasksService.findAllByEvent(stored.eventId ?? '', actor)) as TaskRef[])
    .map((t) => ({ task_id: t.task_id, task_name: t.task_name }));
  // (rebuild groupIds/groupByTitle from the same rows as in processCommand)
  const result = await this.executeActions(stored.plan, currentTasks, stored.eventId, actor, requestId /*, groups */);
  await this.aiRequestRepo.update(requestId, { status: 'success' });
  return { status: 'success', ...result };
}

async cancelCommand(actor: Actor, requestId: string): Promise<object> {
  await this.loadPending(actor, requestId);
  await this.aiRequestRepo.update(requestId, { status: 'cancelled' });
  return { status: 'cancelled' };
}

private async loadPending(actor: Actor, requestId: string) {
  const row = await this.aiRequestRepo.findOne({ where: { request_id: requestId } });
  if (!row) throw new NotFoundException('AI request not found / Không tìm thấy yêu cầu AI');
  if (row.user_id !== actor.sub) throw new ForbiddenException('You do not have permission for this request / Bạn không có quyền với yêu cầu này');
  if (row.status !== 'awaiting_confirmation') throw new BadRequestException('This request is no longer awaiting confirmation / Yêu cầu này không còn chờ xác nhận');
  if (Date.now() - new Date(row.created_at).getTime() > AiService.CONFIRM_TTL_MS) {
    await this.aiRequestRepo.update(requestId, { status: 'cancelled' });
    throw new BadRequestException('This AI plan has expired — please re-issue the command / Kế hoạch AI đã hết hạn — vui lòng yêu cầu lại');
  }
  return row;
}
```
Import `NotFoundException`, `ForbiddenException` from `@nestjs/common`. Refactor the group-context build into a small helper so `processCommand` and `confirmCommand` share it.

- [ ] **Step 4: Run AI specs** → PASS. **Commit:** `feat(ai): ask-mode plan preview + confirm/cancel endpoints`.

---

# PHASE 4 — Event actions (organizer/admin)

### Task 4.1: Event context + `resolveEventRef`

**Files:** Modify `ai.service.ts`; Test `ai.service.spec.ts`.

- [ ] **Step 1: Build event context.** Add a context fetch (used by reads in Phase 6 too): `const viewableEvents = (await this.events.findForViewer(actor)) as Array<{event_id:string;event_name:string;start_time:string;end_time:string}>;` Build `resolveEventRef(ref, viewableEvents, defaultEventId)`:

```typescript
private resolveEventRef(ref: string | undefined, events: { event_id: string; event_name: string }[], defaultEventId?: string): string | null {
  if (!ref) return defaultEventId ?? null;
  const needle = ref.trim().toLowerCase();
  return events.find((e) => e.event_id.toLowerCase() === needle)?.event_id
    ?? events.find((e) => e.event_name.trim().toLowerCase() === needle)?.event_id
    ?? null;
}
```
Pass `viewableEvents` into `executeActions`/`runAction`.

- [ ] **Step 2: Test resolution** then implement. **Commit:** `feat(ai): event context + resolveEventRef`.

### Task 4.2: `create_event` / `update_event` / `delete_event`

**Files:** Modify `ai.service.ts`, `ai.types.ts`, `ai.service.spec.ts` (mock `events.create/update/remove/findForViewer/assertCanManageEvent`).

- [ ] **Step 1: Types** — add to `ai.types.ts`:

```typescript
export interface CreateEventAction { action: 'create_event'; event_name: string; start_time: string; end_time: string; description?: string; }
export interface UpdateEventAction { action: 'update_event'; event_ref: string; event_name?: string; description?: string; }
export interface DeleteEventAction { action: 'delete_event'; event_ref: string; }
```
(add to union; validate required fields in `validateActions`).

- [ ] **Step 2: Tests** — organizer create_event calls `events.create` with `created_by` = actor.sub; update/delete resolve `event_ref` then call the service after `assertCanManageEvent`:

```typescript
it('create_event (organizer) calls events.create with created_by from JWT', async () => {
  const { service, events } = build('organizer'); // build() gains an optional role arg
  events.create = jest.fn().mockResolvedValue({ event_id: 'e9', event_name: 'Gala' });
  mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify([
    { action: 'create_event', event_name: 'Gala', start_time: '2026-07-01T09:00:00', end_time: '2026-07-02T18:00:00' },
  ])));
  const r = (await service.processCommand({ sub: 'o1', role: 'organizer' }, { message: 'make a gala next month' })) as any;
  expect(events.create).toHaveBeenCalledWith(
    expect.objectContaining({ event_name: 'Gala', created_by: 'o1' }), [],
  );
  expect(r.events_changed[0]).toMatchObject({ action: 'create_event', event_id: 'e9' });
});

it('create_event is rejected for a manager (role gate)', async () => {
  const { service, events } = build('manager');
  events.create = jest.fn();
  mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify([
    { action: 'create_event', event_name: 'X', start_time: '2026-07-01T09:00:00', end_time: '2026-07-02T18:00:00' },
  ])));
  const r = (await service.processCommand({ sub: 'u1', role: 'manager' }, { message: 'make event' })) as any;
  expect(events.create).not.toHaveBeenCalled();
  expect(r.rejected[0].reason).toMatch(/role/i);
});
```
Update `build()` to accept a role and stub `events.create/update/remove/findForViewer` (default `findForViewer` → `[]`).

- [ ] **Step 3: Implement handlers** in `runAction`:

```typescript
case 'create_event': {
  try {
    const ev = await this.events.create(
      { event_name: item.event_name, description: item.description,
        start_time: new Date(item.start_time), end_time: new Date(item.end_time),
        created_by: actor.sub },
      [],
    );
    res.events_changed.push({ action: 'create_event', event_id: (ev as { event_id: string }).event_id, event_name: (ev as { event_name: string }).event_name });
  } catch (e) { res.rejected.push({ ref: item.event_name, reason: this.reason(e) }); }
  break;
}
case 'update_event': {
  const id = this.resolveEventRef(item.event_ref, viewableEvents, defaultEventId);
  if (!id) { res.unresolved.push(item.event_ref); break; }
  try {
    await this.events.assertCanManageEvent(actor, id);
    const ev = await this.events.update(id, { event_name: item.event_name, description: item.description });
    res.events_changed.push({ action: 'update_event', event_id: id, event_name: (ev as { event_name?: string }).event_name });
  } catch (e) { res.rejected.push({ ref: item.event_ref, reason: this.reason(e) }); }
  break;
}
case 'delete_event': {
  const id = this.resolveEventRef(item.event_ref, viewableEvents, defaultEventId);
  if (!id) { res.unresolved.push(item.event_ref); break; }
  try {
    await this.events.assertCanManageEvent(actor, id);
    await this.events.remove(id);
    res.events_changed.push({ action: 'delete_event', event_id: id });
  } catch (e) { res.rejected.push({ ref: item.event_ref, reason: this.reason(e) }); }
  break;
}
```

- [ ] **Step 4: Run AI specs** → PASS. **Commit:** `feat(ai): create/update/delete event actions`.

### Task 4.3: `add_event_manager` / `remove_event_manager`

**Files:** Modify `ai.service.ts`, `ai.types.ts`, `ai.service.spec.ts`.

- [ ] **Step 1: Types + manager resolution.** Add actions with `event_ref` + `manager_ref`. Resolve `manager_ref` to a `user_id` via the roster/`userRepo` (reuse `resolveAssignee` → returns a `User`; require `role === 'manager'`).

- [ ] **Step 2: Tests** — organizer add/remove resolve refs then call `events.addManager(eventId, managerId, true)` / `events.removeManager(eventId, managerId)` after `assertCanManageEvent`.

- [ ] **Step 3: Implement**

```typescript
case 'add_event_manager': {
  const id = this.resolveEventRef(item.event_ref, viewableEvents, defaultEventId);
  const mgr = await this.resolveAssignee(item.manager_ref);
  if (!id || !mgr) { res.unresolved.push(!id ? item.event_ref : item.manager_ref); break; }
  try {
    await this.events.assertCanManageEvent(actor, id);
    await this.events.addManager(id, mgr.user_id, true);
    res.events_changed.push({ action: 'add_event_manager', event_id: id });
  } catch (e) { res.rejected.push({ ref: item.manager_ref, reason: this.reason(e) }); }
  break;
}
case 'remove_event_manager': {
  const id = this.resolveEventRef(item.event_ref, viewableEvents, defaultEventId);
  const mgr = await this.resolveAssignee(item.manager_ref);
  if (!id || !mgr) { res.unresolved.push(!id ? item.event_ref : item.manager_ref); break; }
  try {
    await this.events.assertCanManageEvent(actor, id);
    await this.events.removeManager(id, mgr.user_id);
    res.events_changed.push({ action: 'remove_event_manager', event_id: id });
  } catch (e) { res.rejected.push({ ref: item.manager_ref, reason: this.reason(e) }); }
  break;
}
```

- [ ] **Step 4: Run AI specs** → PASS. **Commit:** `feat(ai): event membership add/remove actions`.

---

# PHASE 5 — Account / team actions

### Task 5.1: `create_user` / `update_user` / `reset_password`

**Files:** Modify `ai.service.ts`, `ai.types.ts`, `ai.service.spec.ts` (mock `usersService.create/update`, inject `UsersService`).

- [ ] **Step 1: Inject `UsersService`** into `AiService` constructor (`private readonly users: UsersService`); update `build()` in the spec to pass a `usersService` mock.

- [ ] **Step 2: Types** — `create_user { name, email, role?, phone?, password? }`, `update_user { user_ref, name?, role?, is_active? }`, `reset_password { user_ref, new_password }`. Validate required fields.

- [ ] **Step 3: Tests** — including the role-gate replication:

```typescript
it('manager create_user defaults to staff and is rejected if it names a non-staff role', async () => {
  const { service, usersService } = build('manager');
  usersService.create = jest.fn().mockResolvedValue({ user_id: 'n1', name: 'New' });
  mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify([
    { action: 'create_user', name: 'New', email: 'n@x.com', phone: '0900000001', role: 'manager' },
  ])));
  const r = (await service.processCommand({ sub: 'm1', role: 'manager' }, { message: 'add a manager named New' })) as any;
  expect(usersService.create).not.toHaveBeenCalled();
  expect(r.rejected[0].reason).toMatch(/admin/i);
});

it('reset_password is admin-only', async () => {
  const { service, usersService } = build('manager');
  usersService.update = jest.fn();
  mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify([
    { action: 'reset_password', user_ref: 'staff01@eventops.com', new_password: 'x12345' },
  ])));
  const r = (await service.processCommand({ sub: 'm1', role: 'manager' }, { message: 'reset their password' })) as any;
  // role gate: reset_password not in manager allow-list
  expect(usersService.update).not.toHaveBeenCalled();
  expect(r.rejected[0].reason).toMatch(/role/i);
});
```

- [ ] **Step 4: Implement** (resolve `user_ref` via `resolveAssignee`; replicate the controller's `assertCanAssignRole` for `create_user`; pass `actor` so the service enforces own-staff/role/password):

```typescript
case 'create_user': {
  // Replicate UsersController.assertCanAssignRole: a manager may only create staff.
  if (actor.role !== 'admin' && item.role && item.role !== 'staff') {
    res.rejected.push({ ref: item.email, reason: 'Only an admin can assign a non-staff role' });
    break;
  }
  try {
    const u = await this.users.create(
      { name: item.name, email: item.email, phone: item.phone ?? '', password: item.password ?? this.tempPassword(), role: item.role },
      actor,
    );
    res.users_changed.push({ action: 'create_user', user_id: (u as { user_id: string }).user_id, summary: `Created ${item.name}` });
  } catch (e) { res.rejected.push({ ref: item.email, reason: this.reason(e) }); }
  break;
}
case 'update_user': {
  const target = await this.resolveAssignee(item.user_ref);
  if (!target) { res.unresolved.push(item.user_ref); break; }
  // Activating/deactivating is admin-only (mirrors UsersController).
  if (item.is_active !== undefined && actor.role !== 'admin') {
    res.rejected.push({ ref: item.user_ref, reason: 'Only an admin can activate or deactivate accounts' });
    break;
  }
  try {
    await this.users.update(target.user_id, { name: item.name, role: item.role, is_active: item.is_active }, actor);
    res.users_changed.push({ action: 'update_user', user_id: target.user_id, summary: `Updated ${target.name}` });
  } catch (e) { res.rejected.push({ ref: item.user_ref, reason: this.reason(e) }); }
  break;
}
case 'reset_password': {
  const target = await this.resolveAssignee(item.user_ref);
  if (!target) { res.unresolved.push(item.user_ref); break; }
  try {
    await this.users.update(target.user_id, { password: item.new_password }, actor);
    res.users_changed.push({ action: 'reset_password', user_id: target.user_id, summary: `Reset password for ${target.name}` });
  } catch (e) { res.rejected.push({ ref: item.user_ref, reason: this.reason(e) }); }
  break;
}
```
Add `private tempPassword(): string` returning a fixed-length random-ish string built from the request id (avoid `Math.random` in services per repo norms — derive from `aiRequestId` + index).

- [ ] **Step 5: Run AI specs** → PASS. **Commit:** `feat(ai): account actions (create/update user, reset password) with role gate`.

### Task 5.2: Staff reassignment actions

**Files:** Modify `ai.service.ts`, `ai.types.ts`, `ai.service.spec.ts` (mock `usersService.requestReassign/acceptReassign/rejectReassign/cancelReassign`).

- [ ] **Step 1: Types** — `request_reassign { staff_ref, target_manager_ref }`, `accept_reassign|reject_reassign|cancel_reassign { staff_ref }`.

- [ ] **Step 2: Tests** — resolve `staff_ref`/`target_manager_ref`, then call the matching `usersService` method with `actor`.

- [ ] **Step 3: Implement**

```typescript
case 'request_reassign': {
  const staff = await this.resolveAssignee(item.staff_ref);
  const mgr = await this.resolveAssignee(item.target_manager_ref);
  if (!staff || !mgr) { res.unresolved.push(!staff ? item.staff_ref : item.target_manager_ref); break; }
  try {
    await this.users.requestReassign(staff.user_id, mgr.user_id, actor);
    res.users_changed.push({ action: 'request_reassign', user_id: staff.user_id, summary: `Requested move of ${staff.name}` });
  } catch (e) { res.rejected.push({ ref: item.staff_ref, reason: this.reason(e) }); }
  break;
}
case 'accept_reassign':
case 'reject_reassign':
case 'cancel_reassign': {
  const staff = await this.resolveAssignee(item.staff_ref);
  if (!staff) { res.unresolved.push(item.staff_ref); break; }
  try {
    const fn = item.action === 'accept_reassign' ? this.users.acceptReassign
      : item.action === 'reject_reassign' ? this.users.rejectReassign
      : this.users.cancelReassign;
    await fn.call(this.users, staff.user_id, actor);
    res.users_changed.push({ action: item.action, user_id: staff.user_id, summary: `${item.action} for ${staff.name}` });
  } catch (e) { res.rejected.push({ ref: item.staff_ref, reason: this.reason(e) }); }
  break;
}
```

- [ ] **Step 4: Run AI specs** → PASS. **Commit:** `feat(ai): staff reassignment request/accept/reject/cancel actions`.

---

# PHASE 6 — Role-scoped context block, generative + clarification prompt, action cap

### Task 6.1: Build the role-scoped context block

**Files:** Modify `ai.service.ts`; Test `ai.service.spec.ts`.

- [ ] **Step 1: Test** — when `events.findForViewer` returns events and `userRepo` returns staff, the system prompt sent to the model contains the event names and staff names (assert on the axios body `messages[0].content`).

- [ ] **Step 2: Implement `buildContextBlock(actor, eventId, currentTasks, viewableEvents)`** returning a string with: actor role + now; up to 20 viewable events (name, window, `task_count`/`completed_count` if present) sorted by nearest `end_time`, with an overflow note if truncated; the current event's tasks (name/status/deadline/assignees/group) when `eventId` set; and the assignable roster (manager's own active staff via `userRepo.find({ where: { manager_id: actor.sub, is_active: true } })`; for organizer/admin, omit or use event staff — keep to a bounded list). Insert this block into `systemPrompt` (replaces/extends today's `taskList` + `windowInfo`).

- [ ] **Step 3: Run AI specs** → PASS. **Commit:** `feat(ai): role-scoped context block for reads + assignment`.

### Task 6.2: Rewrite the system prompt (role-gated catalog, generative, anti-nag, answer/clarify)

**Files:** Modify `ai.service.ts`; Test `ai.service.spec.ts`.

- [ ] **Step 1: Test (anti-nag)** — a generative goal yields a create array, not a clarification. Mock the model to return an array for "create all the tasks for a birthday party"; assert `status: 'success'` and `tasks_created.length >= 1` (the test asserts our handling, given a generative reply).

- [ ] **Step 2: Implement the prompt.** Build the **advertised action list from the actor's role** (filter `AI_ACTION_ROLES` by `actor.role`) so the model only sees allowed shapes. Include: the JSON-array contract; the answer shape `{ "answer": "…" }` for questions; the clarification shape `{ "clarification_needed": true, "question": "…" }`; the **anti-nag rule** (prefer sensible defaults, ask only when truly blocked; generative goals must not ask); the **generative guidance** (decompose a high-level goal into a full checklist, set `group` titles, spread `assigned_to` across the roster, deadlines inside the event window); and the existing hard date-window constraint. Keep the JSON-only / no-markdown instruction.

- [ ] **Step 3: Run AI specs** → PASS. **Commit:** `feat(ai): role-aware generative prompt with answer/clarification`.

### Task 6.3: Enforce the 40-action cap

**Files:** Modify `ai.service.ts`; Test `ai.service.spec.ts`.

- [ ] **Step 1: Test** — a 45-create reply executes 40 and reports `skipped >= 5`.

- [ ] **Step 2: Implement** — in `validateActions` (or right after), if `actions.length > 40`, set `skipped += actions.length - 40` and truncate to 40.

- [ ] **Step 3: Run AI specs** → PASS. **Commit:** `feat(ai): cap AI commands at 40 actions`.

### Task 6.4: Full backend regression

- [ ] **Step 1: Typecheck + full unit suite**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: compiles; all suites PASS.

- [ ] **Step 2: Live smoke test** (server running, key configured) — log in as manager01, run an `ask`-mode "create 3 birthday tasks" command, confirm it, verify tasks appear; run a question and assert an `answered` response. Use the Node/axios pattern from earlier in this repo's session (login → `/api/ai/command`). Delete any tasks created during smoke test.

- [ ] **Step 3: Commit** (if any fixups) — `test(ai): backend regression for operations partner`.

---

# PHASE 7 — Frontend: remove panel, add context-aware AI drawer

> Before each frontend task, read the relevant guide in `event-ops-frontend/node_modules/next/dist/docs/` (App Router, client components, hooks). Frontend has no unit tests; verify by running the app.

### Task 7.1: Remove the standalone AI page + nav

**Files:**
- Delete: `event-ops-frontend/src/app/ai/page.tsx`
- Modify: `event-ops-frontend/src/components/Sidebar.tsx:29`

- [ ] **Step 1:** Delete `src/app/ai/page.tsx` (and the `ai/` folder if now empty).
- [ ] **Step 2:** Remove the `{ href: '/ai', … }` nav entry at `Sidebar.tsx:29` and any now-unused `Bot` import.
- [ ] **Step 3: Build** — `npm run build` (or `npm run lint`) → no references to the removed route remain.
- [ ] **Step 4: Commit** — `feat(ai-ui): remove standalone AI page and nav item`.

### Task 7.2: `aiApi` helpers

**Files:** Modify `event-ops-frontend/src/lib/api.ts`.

- [ ] **Step 1:** Add helpers using the existing `api` axios instance:

```typescript
export const aiApi = {
  command: (body: { eventId?: string; message: string; mode: 'auto' | 'ask'; history: { role: 'user' | 'assistant'; content: string }[] }) =>
    api.post('/ai/command', body).then((r) => r.data),
  confirm: (requestId: string) => api.post(`/ai/command/${requestId}/confirm`).then((r) => r.data),
  cancel: (requestId: string) => api.post(`/ai/command/${requestId}/cancel`).then((r) => r.data),
};
```

- [ ] **Step 2: Build** → compiles. **Commit:** `feat(ai-ui): aiApi client helpers`.

### Task 7.3: `<AiDrawer>` component

**Files:** Create `event-ops-frontend/src/components/AiDrawer.tsx`.

- [ ] **Step 1: Implement** a client component (`'use client'`) that:
  - Derives `eventId` from the current route (e.g. `usePathname()`/`useSearchParams()` or a context the tasks page sets). On the tasks view, pass the selected event's id; elsewhere pass `undefined`.
  - Holds state: `open`, `mode` (from `localStorage['ai_confirm_mode'] || 'auto'`), `transcript: {role,content}[]`, `input`, `pending` (the last `pending_confirmation` response), `busy`.
  - Renders a slide-over panel (non-modal; reuse existing drawer/modal styling in the codebase) with: a Mode toggle (Auto-accept / Ask, persisting to `localStorage`), a transcript view, and an input box.
  - On send: append `{role:'user',content:input}` to transcript, call `aiApi.command({ eventId, message: input, mode, history: transcript })`, then branch on `res.status`:
    - `answered` → append `{role:'assistant',content:res.answer}`.
    - `needs_clarification` → append `{role:'assistant',content:res.question}`; keep input focused for the answer.
    - `pending_confirmation` → store `res` in `pending`; render its `plan` descriptions with **Confirm**/**Cancel** → `aiApi.confirm(res.request_id)` / `aiApi.cancel(res.request_id)`; on confirm append a results summary.
    - `success` → append a results summary line (counts from `tasks_created`/`…`/`events_changed`/`users_changed` + any `unresolved`/`rejected`).
  - No manual refetch needed — the underlying page refreshes via its existing `useLiveData` on `data_changed`.

- [ ] **Step 2: Verify by running the app** — see Task 7.5.
- [ ] **Step 3: Commit** — `feat(ai-ui): context-aware AI drawer component`.

### Task 7.4: Mount the drawer + launcher in `AppShell`

**Files:** Modify `event-ops-frontend/src/components/AppShell.tsx`.

- [ ] **Step 1:** Render `<AiDrawer>` once inside the shell (so it overlays every page), gated to `isManager || canManageEvents || isAdmin` (from `AuthContext`). Add a launcher button (header or floating) that toggles the drawer.
- [ ] **Step 2: Build** → compiles. **Commit:** `feat(ai-ui): mount AI drawer + launcher in AppShell`.

### Task 7.5: End-to-end manual verification

- [ ] **Step 1:** Start backend then frontend (per README). Log in as **manager01** → open an event's tasks → open AI drawer (it should carry that `eventId`) → "create 3 tasks for venue setup" in **Ask** mode → preview shows → Confirm → tasks appear in the timeline live.
- [ ] **Step 2:** Log in as **organizer01** → events page → AI drawer (no eventId) → "create an event called Test Gala next month" → event appears in the list live. Ask "which events are behind?" → an answer renders.
- [ ] **Step 3:** Log in as **admin01** → confirm account actions work (e.g. "deactivate staff05") and that a manager attempting the same via AI is rejected.
- [ ] **Step 4:** Clean up any test data created. **Commit** any fixups — `test(ai-ui): manual e2e verification fixups`.

---

## Self-review (completed during authoring)

- **Spec coverage:** task actions (Phase 2), generative `group` (2.3), modes/ask/confirm/cancel (3.3), clarification (3.2), answer/reads (3.2 + 6.1), 3-role access (0.3), role allow-list hard gate (1.1 + per-action), event actions (Phase 4), account incl. sensitive (Phase 5), context block (6.1), prompt/anti-nag/generative (6.2), 40-cap (6.3), migration/status (0.1), drawer + panel removal + live refresh (Phase 7), tests throughout — all mapped to tasks.
- **Authorization correctness:** every event/account/task action passes through the role allow-list (`isActionAllowedForRole`) before any service call, plus the replicated controller checks (`assertCanAssignRole`, admin-only `is_active`, `assertCanManageEvent`) and `actor`-passing services — addressing the split controller/service enforcement found during planning.
- **Type consistency:** `executeActions`/`runAction`/`ExecResult`/`resolveTaskRef`/`resolveGroupRef`/`resolveEventRef`/`resolveAssignee`/`reason`/`loadPending`/`describePlan` names are used consistently across tasks.
- **Open follow-ups (not blockers):** `describePlan` copy and the drawer styling reuse existing UI conventions; admin/organizer assignment roster is best-effort (spec Limitations).
