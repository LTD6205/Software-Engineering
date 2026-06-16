import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';

// Minimal repo/dependency doubles. Each test wires only the methods it needs.
function makeRepo() {
  const manager: Record<string, jest.Mock> = { query: jest.fn() };
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve({ task_id: 't-new', ...x })),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    manager,
  };
  // A transaction runs its callback with an entity-manager that proxies the
  // repo's own mocks, so transactional writes are asserted exactly as before.
  manager.transaction = jest.fn((cb: (em: unknown) => unknown) =>
    cb({
      query: manager.query,
      save: repo.save,
      delete: (_e: unknown, criteria: unknown) => repo.delete(criteria),
      update: (_e: unknown, criteria: unknown, partial: unknown) =>
        repo.update(criteria, partial),
      create: (_e: unknown, dto: unknown) => repo.create(dto),
    }),
  );
  return repo;
}

function build() {
  const taskRepo = makeRepo();
  const assignRepo = makeRepo();
  const groupRepo = makeRepo();
  const logRepo = makeRepo();
  const changeLogRepo = makeRepo();
  const userRepo = makeRepo();
  const eventRepo = makeRepo();
  const gateway = {
    broadcast: jest.fn(),
    sendToUser: jest.fn(),
    broadcastToEvent: jest.fn(),
  };
  const notifications = { notifyUser: jest.fn(), notifyUsers: jest.fn() };
  // Event-access policy lives in EventsService; here it always allows so these
  // tests focus on TasksService logic. Membership enforcement is covered by the
  // EventsService unit tests and the e2e suite.
  const events = {
    getMemberIds: jest.fn(),
    assertCanManageEvent: jest.fn().mockResolvedValue(undefined),
    assertCanViewEvent: jest.fn().mockResolvedValue(undefined),
  };
  const service = new TasksService(
    taskRepo as never,
    assignRepo as never,
    groupRepo as never,
    logRepo as never,
    changeLogRepo as never,
    userRepo as never,
    eventRepo as never,
    gateway as never,
    notifications as never,
    events as never,
  );
  return {
    service,
    taskRepo,
    assignRepo,
    groupRepo,
    logRepo,
    changeLogRepo,
    userRepo,
    eventRepo,
    gateway,
    notifications,
    events,
  };
}

describe('TasksService', () => {
  describe('undoLastChange', () => {
    it('reverts the most recent EDIT, restoring the old field values and dropping the row', async () => {
      const { service, taskRepo, changeLogRepo, eventRepo } = build();
      changeLogRepo.findOne.mockResolvedValue({
        id: 'C1',
        change_type: 'edit',
        snapshot: {
          edited: [
            {
              task_id: 't1',
              fields: { task_name: 'Old', deadline: '2026-06-01T09:00:00.000Z' },
            },
          ],
        },
      });
      taskRepo.findOne.mockResolvedValue({ task_id: 't1', event_id: 'e1' });
      eventRepo.findOne.mockResolvedValue({ event_id: 'e1', status: 'pending' });
      taskRepo.find.mockResolvedValue([]);

      await service.undoLastChange('e1', { sub: 'm1', role: 'manager' });

      expect(taskRepo.update).toHaveBeenCalledWith('t1', {
        task_name: 'Old',
        deadline: '2026-06-01T09:00:00.000Z',
      });
      expect(changeLogRepo.delete).toHaveBeenCalledWith({ id: 'C1' });
    });

    it('reverts the most recent DELETE by re-creating the task and its assignees', async () => {
      const { service, taskRepo, assignRepo, changeLogRepo, eventRepo } =
        build();
      changeLogRepo.findOne.mockResolvedValue({
        id: 'C2',
        change_type: 'delete',
        snapshot: {
          deleted: [
            {
              task: {
                task_name: 'Order cake',
                priority_label: 'low',
                priority_score: 10,
                priority_source: 'ai',
                status: 'in_progress',
                created_by: 'u1',
                group_id: null,
              },
              assignees: ['s1', 's2'],
            },
          ],
        },
      });
      eventRepo.findOne.mockResolvedValue({ event_id: 'e1', status: 'pending' });
      taskRepo.find.mockResolvedValue([]);
      // taskRepo.save returns the re-created task (makeRepo's save echoes input).

      await service.undoLastChange('e1', { sub: 'm1', role: 'manager' });

      // A new task row is saved into the same event…
      expect(taskRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ event_id: 'e1', task_name: 'Order cake' }),
      );
      // …and both assignees are re-attached.
      expect(assignRepo.save).toHaveBeenCalledTimes(2);
      expect(changeLogRepo.delete).toHaveBeenCalledWith({ id: 'C2' });
    });

    it('reverts a CREATE op (incl. an AI batch) by deleting every created task', async () => {
      const { service, taskRepo, changeLogRepo, eventRepo } = build();
      changeLogRepo.findOne.mockResolvedValue({
        id: 'C3',
        change_type: 'create',
        snapshot: { created: ['a', 'b', 'c'] },
      });
      eventRepo.findOne.mockResolvedValue({ event_id: 'e1', status: 'pending' });
      taskRepo.find.mockResolvedValue([]);

      await service.undoLastChange('e1', { sub: 'm1', role: 'manager' });

      // Each created task is hard-deleted (the txn proxy ends in delete(Task, id)).
      expect(taskRepo.delete).toHaveBeenCalledTimes(3);
      expect(changeLogRepo.delete).toHaveBeenCalledWith({ id: 'C3' });
    });

    it('throws when there is nothing to undo', async () => {
      const { service, changeLogRepo } = build();
      changeLogRepo.findOne.mockResolvedValue(null);
      await expect(
        service.undoLastChange('e1', { sub: 'm1', role: 'manager' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeMany (batch delete = one undo op)', () => {
    it('deletes each task and records a single batched op', async () => {
      const { service, taskRepo, assignRepo, changeLogRepo, eventRepo } =
        build();
      taskRepo.findOne.mockResolvedValue({
        task_id: 't',
        event_id: 'e1',
        task_name: 'X',
        group_id: null,
      });
      assignRepo.find.mockResolvedValue([]);
      eventRepo.findOne.mockResolvedValue({ event_id: 'e1', status: 'pending' });
      taskRepo.find.mockResolvedValue([]);

      await service.removeMany(['t1', 't2'], { sub: 'm1', role: 'manager' });

      expect(taskRepo.delete).toHaveBeenCalledTimes(2); // both tasks removed
      // One batched change-log row captures both deletions.
      const batch = changeLogRepo.save.mock.calls.at(-1)?.[0];
      expect(batch.change_type).toBe('delete');
      expect((batch.snapshot.deleted as unknown[]).length).toBe(2);
    });
  });

  describe('create — validation', () => {
    it('rejects a task with no name', async () => {
      const { service } = build();
      await expect(service.create({ event_id: 'e1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a task with no event', async () => {
      const { service } = build();
      await expect(service.create({ task_name: 'X' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a deadline that is not after the start time', async () => {
      const { service } = build();
      await expect(
        service.create({
          task_name: 'X',
          event_id: 'e1',
          start_time: new Date('2026-06-10T10:00:00Z'),
          deadline: new Date('2026-06-10T09:00:00Z'),
        }),
      ).rejects.toThrow(/Deadline must be after/);
    });

    it('defaults status to in_progress and priority_source to auto', async () => {
      const ctx = build();
      ctx.eventRepo.findOne.mockResolvedValue({
        event_id: 'e1',
        event_name: 'E',
        created_by: 'owner',
        status: 'pending',
      });
      ctx.taskRepo.find.mockResolvedValue([]);
      ctx.taskRepo.findOne.mockResolvedValue({ task_id: 't-new' });

      await ctx.service.create({
        task_name: 'X',
        event_id: 'e1',
        created_by: 'owner',
      });

      const saved = ctx.taskRepo.save.mock.calls[0][0];
      expect(saved.status).toBe('in_progress');
      expect(saved.priority_source).toBe('auto');
    });
  });

  describe('create — authorization & window', () => {
    it('derives created_by from the actor and ignores any body value', async () => {
      const ctx = build();
      ctx.eventRepo.findOne.mockResolvedValue({
        event_id: 'e1',
        event_name: 'E',
        created_by: 'owner',
        status: 'pending',
      });
      ctx.taskRepo.find.mockResolvedValue([]);
      ctx.taskRepo.findOne.mockResolvedValue({ task_id: 't-new' });

      await ctx.service.create(
        { task_name: 'X', event_id: 'e1', created_by: 'attacker' },
        { sub: 'real-mgr', role: 'manager' },
      );

      const saved = ctx.taskRepo.save.mock.calls[0][0];
      expect(saved.created_by).toBe('real-mgr');
    });

    it('enforces event membership before creating', async () => {
      const ctx = build();
      ctx.events.assertCanManageEvent.mockRejectedValue(
        new BadRequestException('nope'),
      );
      await expect(
        ctx.service.create(
          { task_name: 'X', event_id: 'e1' },
          { sub: 'outsider', role: 'manager' },
        ),
      ).rejects.toThrow();
    });

    it('rejects a deadline that falls outside the event window', async () => {
      const ctx = build();
      ctx.eventRepo.findOne.mockResolvedValue({
        event_id: 'e1',
        start_time: '2026-06-01T00:00:00Z',
        end_time: '2026-06-30T00:00:00Z',
      });
      await expect(
        ctx.service.create(
          {
            task_name: 'X',
            event_id: 'e1',
            deadline: new Date('2026-07-15T00:00:00Z'),
          },
          { sub: 'm', role: 'manager' },
        ),
      ).rejects.toThrow(/within the event window/);
    });

    it('rejects a start time in the past', async () => {
      const ctx = build();
      // No event row mocked → the window check is skipped; the past guard fires.
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await expect(
        ctx.service.create(
          {
            task_name: 'X',
            event_id: 'e1',
            start_time: past,
            deadline: future,
          },
          { sub: 'm', role: 'manager' },
        ),
      ).rejects.toThrow(/cannot be in the past/);
    });
  });

  describe('update — field & role guards', () => {
    it('blocks a staff member from editing non-status fields', async () => {
      const { service, taskRepo } = build();
      taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        status: 'in_progress',
      });
      await expect(
        service.update(
          't1',
          { deadline: new Date('2026-06-10T00:00:00Z') },
          { sub: 'staff1', role: 'staff' },
        ),
      ).rejects.toThrow(/not allowed to edit/);
    });

    it('checks event membership before a manager edits metadata', async () => {
      const ctx = build();
      ctx.taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        status: 'in_progress',
      });
      ctx.events.assertCanManageEvent.mockRejectedValue(
        new BadRequestException('not your event'),
      );
      await expect(
        ctx.service.update(
          't1',
          { priority_label: 'high' },
          { sub: 'other-mgr', role: 'manager' },
        ),
      ).rejects.toThrow(/not your event/);
    });

    it('drops server-controlled fields (event_id, created_by) from an update', async () => {
      const { service, taskRepo, eventRepo } = build();
      taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        status: 'in_progress',
      });
      eventRepo.findOne.mockResolvedValue(null);
      await service.update(
        't1',
        {
          task_name: 'Renamed',
          event_id: 'e2',
          created_by: 'someone',
        },
        { sub: 'mgr', role: 'manager' },
      );
      const patch = taskRepo.update.mock.calls[0][1];
      expect(patch).toEqual({ task_name: 'Renamed' });
      expect(patch).not.toHaveProperty('event_id');
      expect(patch).not.toHaveProperty('created_by');
    });

    it('rejects moving a deadline into the past', async () => {
      const { service, taskRepo, eventRepo } = build();
      taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        status: 'in_progress',
        created_by: 'mgr',
      });
      eventRepo.findOne.mockResolvedValue(null); // skip the window check
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await expect(
        service.update(
          't1',
          { deadline: past },
          { sub: 'mgr', role: 'manager' },
        ),
      ).rejects.toThrow(/cannot be in the past/);
    });

    it('reverting priority to auto drops any manual label and re-buckets', async () => {
      const ctx = build();
      const DAY = 24 * 60 * 60 * 1000;
      const now = Date.now();
      ctx.taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        status: 'in_progress',
        created_by: 'mgr',
      });
      ctx.eventRepo.findOne.mockResolvedValue(null);
      // The recompute reads the event's tasks: an auto task already past the
      // "now" line always buckets to high, giving a deterministic label.
      ctx.taskRepo.find.mockResolvedValue([
        {
          task_id: 't1',
          priority_source: 'auto',
          group_id: null,
          deadline: new Date(now - 1 * DAY).toISOString(),
        },
      ]);

      await ctx.service.update(
        't1',
        // A client may send a label alongside; the auto source must win and the
        // label be ignored (it's the timeline's to decide).
        { priority_source: 'auto', priority_label: 'low' },
        { sub: 'mgr', role: 'manager' },
      );

      // The row is written with source 'auto' and no pinned label/score…
      const patch = ctx.taskRepo.update.mock.calls[0][1];
      expect(patch.priority_source).toBe('auto');
      expect(patch).not.toHaveProperty('priority_label');
      expect(patch).not.toHaveProperty('priority_score');
      // …and the recompute then buckets it (a second update sets the label).
      const rebucket = ctx.taskRepo.update.mock.calls.find(
        ([, p]) => p.priority_label !== undefined,
      );
      expect(rebucket?.[1].priority_label).toBe('high');
    });

    it('slides an overdue task forward to now when it is reopened', async () => {
      const ctx = build();
      const DAY = 24 * 60 * 60 * 1000;
      const now = Date.now();
      ctx.taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        status: 'overdue',
        created_by: 'mgr',
        start_time: new Date(now - 3 * DAY),
        deadline: new Date(now - 2 * DAY), // 1-day task, 2 days overdue
      });
      ctx.assignRepo.find.mockResolvedValue([]);
      ctx.eventRepo.findOne.mockResolvedValue({
        event_id: 'e1',
        start_time: new Date(now - 10 * DAY),
        end_time: new Date(now + 10 * DAY),
      });
      ctx.taskRepo.find.mockResolvedValue([]); // recompute no-op

      await ctx.service.update(
        't1',
        { status: 'in_progress' },
        { sub: 'mgr', role: 'manager' },
      );

      const patch = ctx.taskRepo.update.mock.calls[0][1];
      expect(patch.status).toBe('in_progress');
      // Slid to start ~now, preserving the 1-day length, both no longer past.
      expect(new Date(patch.start_time).getTime()).toBeGreaterThanOrEqual(
        now - 1000,
      );
      expect(new Date(patch.deadline).getTime()).toBeGreaterThan(now);
    });
  });

  describe('recomputeAutoPriorities — timeline bucketing', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const iso = (ms: number) => new Date(ms).toISOString();

    it('buckets auto tasks into high/medium/low from now to the latest deadline', async () => {
      const { service, taskRepo } = build();
      const now = Date.now();
      // Three future tasks spanning now → now+30d: soonest=high, mid=medium, late=low.
      taskRepo.find.mockResolvedValue([
        {
          task_id: 'a',
          priority_source: 'auto',
          group_id: null,
          deadline: iso(now + 1 * DAY),
        },
        {
          task_id: 'b',
          priority_source: 'auto',
          group_id: null,
          deadline: iso(now + 15 * DAY),
        },
        {
          task_id: 'c',
          priority_source: 'auto',
          group_id: null,
          deadline: iso(now + 30 * DAY),
        },
      ]);

      await (
        service as never as {
          recomputeAutoPriorities(id: string): Promise<void>;
        }
      ).recomputeAutoPriorities('e1');

      const updates = Object.fromEntries(
        taskRepo.update.mock.calls.map(([id, patch]) => [
          id,
          patch.priority_label,
        ]),
      );
      expect(updates.a).toBe('high');
      expect(updates.b).toBe('medium');
      expect(updates.c).toBe('low');
    });

    it("ranks a group's members within their own span; ungrouped rank from now", async () => {
      const { service, taskRepo } = build();
      const now = Date.now();
      // All future (none overdue). The group sits in a narrow late slice — on a
      // single now→latest timeline its members would share a bucket; per-group
      // they split high/low so the earlier member outranks the later one.
      taskRepo.find.mockResolvedValue([
        {
          task_id: 'u1',
          priority_source: 'auto',
          group_id: null,
          deadline: iso(now + 1 * DAY),
        },
        {
          task_id: 'u2',
          priority_source: 'auto',
          group_id: null,
          deadline: iso(now + 30 * DAY),
        },
        {
          task_id: 'a',
          priority_source: 'auto',
          group_id: 'g1',
          deadline: iso(now + 20 * DAY),
        },
        {
          task_id: 'b',
          priority_source: 'auto',
          group_id: 'g1',
          deadline: iso(now + 21 * DAY),
        },
      ]);

      await (
        service as never as {
          recomputeAutoPriorities(id: string): Promise<void>;
        }
      ).recomputeAutoPriorities('e1');

      const updates = Object.fromEntries(
        taskRepo.update.mock.calls.map(([id, patch]) => [
          id,
          patch.priority_label,
        ]),
      );
      // Within group g1 the earlier member is high, the later one low.
      expect(updates.a).toBe('high');
      expect(updates.b).toBe('low');
      // Ungrouped tasks rank from now → latest.
      expect(updates.u1).toBe('high');
      expect(updates.u2).toBe('low');
    });

    it('forces overdue tasks (past the now line) to high, grouped or not', async () => {
      const { service, taskRepo } = build();
      const now = Date.now();
      taskRepo.find.mockResolvedValue([
        {
          task_id: 'past',
          priority_source: 'auto',
          group_id: null,
          deadline: iso(now - 2 * DAY),
        },
        {
          task_id: 'future',
          priority_source: 'auto',
          group_id: null,
          deadline: iso(now + 20 * DAY),
        },
        {
          task_id: 'gpast',
          priority_source: 'auto',
          group_id: 'g1',
          deadline: iso(now - 1 * DAY),
        },
        {
          task_id: 'gfuture',
          priority_source: 'auto',
          group_id: 'g1',
          deadline: iso(now + 5 * DAY),
        },
      ]);

      await (
        service as never as {
          recomputeAutoPriorities(id: string): Promise<void>;
        }
      ).recomputeAutoPriorities('e1');

      const updates = Object.fromEntries(
        taskRepo.update.mock.calls.map(([id, patch]) => [
          id,
          patch.priority_label,
        ]),
      );
      // Anything before "now" is High, whether ungrouped or a group member.
      expect(updates.past).toBe('high');
      expect(updates.gpast).toBe('high');
      // A still-future task is not forced high.
      expect(updates.future).toBe('low');
    });

    it('never overwrites a manually-set (user) or AI priority', async () => {
      const { service, taskRepo } = build();
      taskRepo.find.mockResolvedValue([
        {
          task_id: 'a',
          priority_source: 'user',
          deadline: '2026-06-01T00:00:00Z',
        },
        {
          task_id: 'b',
          priority_source: 'ai',
          deadline: '2026-06-04T00:00:00Z',
        },
      ]);

      await (
        service as never as {
          recomputeAutoPriorities(id: string): Promise<void>;
        }
      ).recomputeAutoPriorities('e1');

      expect(taskRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('assignment rules (assertAssignable via setAssignees)', () => {
    it('rejects assigning a task to a non-staff user', async () => {
      const { service, taskRepo, userRepo } = build();
      taskRepo.findOne.mockResolvedValue({ task_id: 't1', event_id: 'e1' });
      userRepo.findOne.mockResolvedValue({ user_id: 'm1', role: 'manager' });

      await expect(service.setAssignees('t1', ['m1'])).rejects.toThrow(
        /only be assigned to staff/,
      );
    });

    it("rejects a manager assigning another manager's staff", async () => {
      const { service, taskRepo, userRepo } = build();
      taskRepo.findOne.mockResolvedValue({ task_id: 't1', event_id: 'e1' });
      userRepo.findOne.mockResolvedValue({
        user_id: 's1',
        role: 'staff',
        manager_id: 'otherManager',
      });

      await expect(
        service.setAssignees('t1', ['s1'], { sub: 'me', role: 'manager' }),
      ).rejects.toThrow(/only assign your own staff/);
    });

    it('allows a manager to assign a task to themselves', async () => {
      const { service, taskRepo, userRepo, assignRepo } = build();
      taskRepo.findOne.mockResolvedValue({ task_id: 't1', event_id: 'e1' });
      // The actor (a manager) is not a 'staff' user, but self-assignment is OK.
      userRepo.findOne.mockResolvedValue({
        user_id: 'mgr1',
        role: 'manager',
        manager_id: null,
      });
      assignRepo.find.mockResolvedValue([]);
      assignRepo.manager.query.mockResolvedValue([]);

      await expect(
        service.setAssignees('t1', ['mgr1'], { sub: 'mgr1', role: 'manager' }),
      ).resolves.toBeDefined();
    });

    it('still rejects a manager assigning a different non-staff user', async () => {
      const { service, taskRepo, userRepo } = build();
      taskRepo.findOne.mockResolvedValue({ task_id: 't1', event_id: 'e1' });
      userRepo.findOne.mockResolvedValue({ user_id: 'other', role: 'manager' });

      await expect(
        service.setAssignees('t1', ['other'], { sub: 'mgr1', role: 'manager' }),
      ).rejects.toThrow(/only be assigned to staff/);
    });

    it('throws NotFound when the assignee does not exist', async () => {
      const { service, taskRepo, userRepo } = build();
      taskRepo.findOne.mockResolvedValue({ task_id: 't1', event_id: 'e1' });
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.setAssignees('t1', ['ghost'])).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('assertStatusChangeAllowed (via update)', () => {
    it('rejects a status change by someone who is neither creator nor assignee', async () => {
      const { service, taskRepo, assignRepo } = build();
      taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        status: 'in_progress',
        created_by: 'owner',
      });
      assignRepo.find.mockResolvedValue([{ user_id: 'someoneElse' }]);

      await expect(
        service.update(
          't1',
          { status: 'completed' },
          { sub: 'intruder', role: 'staff' },
        ),
      ).rejects.toThrow(/not allowed to change/);
    });

    it('blocks assigned staff (non-creator) from reopening a completed task', async () => {
      const { service, taskRepo, assignRepo } = build();
      taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        status: 'completed',
        created_by: 'owner',
      });
      assignRepo.find.mockResolvedValue([{ user_id: 'staffer' }]);

      await expect(
        service.update(
          't1',
          { status: 'in_progress' },
          { sub: 'staffer', role: 'staff' },
        ),
      ).rejects.toThrow(/Only the creator can reopen/);
    });
  });

  describe('viewer-scoped reads (GET /tasks/:id, /:id/assignments)', () => {
    it('findOneForViewer denies a viewer who cannot see the task event', async () => {
      const { service, taskRepo, events } = build();
      taskRepo.findOne.mockResolvedValue({ task_id: 't1', event_id: 'e1' });
      events.assertCanViewEvent.mockRejectedValue(
        new BadRequestException('no'),
      );
      await expect(
        service.findOneForViewer('t1', { sub: 'outsider', role: 'manager' }),
      ).rejects.toThrow();
      expect(events.assertCanViewEvent).toHaveBeenCalledWith(
        { sub: 'outsider', role: 'manager' },
        'e1',
      );
    });

    it('findOneForViewer returns the task when its event is visible', async () => {
      const { service, taskRepo } = build();
      taskRepo.findOne.mockResolvedValue({ task_id: 't1', event_id: 'e1' });
      const r = await service.findOneForViewer('t1', {
        sub: 'm',
        role: 'manager',
      });
      expect((r as { task_id: string }).task_id).toBe('t1');
    });

    it('getAssignmentsForViewer enforces event visibility before reading rows', async () => {
      const { service, taskRepo, assignRepo, events } = build();
      taskRepo.findOne.mockResolvedValue({ task_id: 't1', event_id: 'e1' });
      events.assertCanViewEvent.mockRejectedValue(
        new BadRequestException('no'),
      );
      await expect(
        service.getAssignmentsForViewer('t1', {
          sub: 'outsider',
          role: 'staff',
        }),
      ).rejects.toThrow();
      expect(assignRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('merge — validation', () => {
    it('rejects merging a task with itself', async () => {
      const { service } = build();
      await expect(service.merge('t1', 't1')).rejects.toThrow(
        /merge a task with itself/,
      );
    });

    it('rejects merging tasks from different events', async () => {
      const { service, taskRepo } = build();
      taskRepo.findOne
        .mockResolvedValueOnce({ task_id: 's', event_id: 'eA' })
        .mockResolvedValueOnce({ task_id: 't', event_id: 'eB' });

      await expect(service.merge('s', 't')).rejects.toThrow(/same event/);
    });
  });
});
