import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';

// Minimal repo/dependency doubles. Each test wires only the methods it needs.
function makeRepo() {
  const manager: Record<string, jest.Mock> = { query: jest.fn() };
  const repo = {
    // Default to an empty task set so the recomputeAutoPriorities that now runs
    // after merge/addToGroup/ungroup is a harmless no-op unless a test overrides it.
    find: jest.fn().mockResolvedValue([]),
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
  // Event-access policy is mocked to always allow here; membership enforcement
  // is covered by the EventsService unit tests and the e2e suite.
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
    userRepo,
    eventRepo,
    gateway,
    notifications,
    events,
  };
}

describe('TasksService — groups, assignments, status', () => {
  // ── merge — happy paths ────────────────────────────────────
  describe('merge — happy path', () => {
    it('creates a new group when target has none and links both tasks', async () => {
      const { service, taskRepo, groupRepo } = build();
      taskRepo.findOne
        .mockResolvedValueOnce({ task_id: 's', event_id: 'e1', group_id: null }) // source
        .mockResolvedValueOnce({
          task_id: 't',
          event_id: 'e1',
          group_id: null,
        }); // target
      groupRepo.save.mockResolvedValue({ group_id: 'g-new', event_id: 'e1' });

      const res = await service.merge('s', 't');

      expect(res).toEqual({ group_id: 'g-new' });
      // A new group was created.
      expect(groupRepo.save).toHaveBeenCalledTimes(1);
      // Both tasks were linked to the new group.
      expect(taskRepo.update).toHaveBeenCalledWith('t', { group_id: 'g-new' });
      expect(taskRepo.update).toHaveBeenCalledWith('s', { group_id: 'g-new' });
    });

    it('joins the existing target group (no new group) when target already grouped', async () => {
      const { service, taskRepo, groupRepo } = build();
      taskRepo.findOne
        .mockResolvedValueOnce({ task_id: 's', event_id: 'e1', group_id: null })
        .mockResolvedValueOnce({
          task_id: 't',
          event_id: 'e1',
          group_id: 'g1',
        });

      const res = await service.merge('s', 't');

      expect(res).toEqual({ group_id: 'g1' });
      // No new group created.
      expect(groupRepo.save).not.toHaveBeenCalled();
      // Only the source is updated; the target already belongs to g1.
      expect(taskRepo.update).toHaveBeenCalledTimes(1);
      expect(taskRepo.update).toHaveBeenCalledWith('s', { group_id: 'g1' });
    });

    it('dissolves the source old group when it now has < 2 members', async () => {
      const { service, taskRepo, groupRepo } = build();
      taskRepo.findOne
        .mockResolvedValueOnce({
          task_id: 's',
          event_id: 'e1',
          group_id: 'gOld',
        })
        .mockResolvedValueOnce({
          task_id: 't',
          event_id: 'e1',
          group_id: 'g1',
        });
      taskRepo.count.mockResolvedValue(1); // gOld now too small

      await service.merge('s', 't');

      expect(taskRepo.count).toHaveBeenCalledWith({
        where: { group_id: 'gOld' },
      });
      expect(groupRepo.delete).toHaveBeenCalledWith('gOld');
    });

    it('keeps the source old group when it still has >= 2 members', async () => {
      const { service, taskRepo, groupRepo } = build();
      taskRepo.findOne
        .mockResolvedValueOnce({
          task_id: 's',
          event_id: 'e1',
          group_id: 'gOld',
        })
        .mockResolvedValueOnce({
          task_id: 't',
          event_id: 'e1',
          group_id: 'g1',
        });
      taskRepo.count.mockResolvedValue(2); // gOld still big enough

      await service.merge('s', 't');

      expect(groupRepo.delete).not.toHaveBeenCalled();
    });
  });

  // ── addToGroup ─────────────────────────────────────────────
  describe('addToGroup', () => {
    it('throws NotFound when the group is missing', async () => {
      const { service, groupRepo } = build();
      groupRepo.findOne.mockResolvedValue(null);

      await expect(service.addToGroup('gX', 't1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequest when the task is in a different event', async () => {
      const { service, groupRepo, taskRepo } = build();
      groupRepo.findOne.mockResolvedValue({ group_id: 'g1', event_id: 'eA' });
      taskRepo.findOne.mockResolvedValue({ task_id: 't1', event_id: 'eB' });

      await expect(service.addToGroup('g1', 't1')).rejects.toThrow(
        /same event/,
      );
    });

    it('is a no-op when the task already belongs to that group', async () => {
      const { service, groupRepo, taskRepo } = build();
      groupRepo.findOne.mockResolvedValue({ group_id: 'g1', event_id: 'e1' });
      taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        group_id: 'g1',
      });

      const res = await service.addToGroup('g1', 't1');

      expect(res).toEqual({ group_id: 'g1' });
      expect(taskRepo.update).not.toHaveBeenCalled();
    });

    it('moves the task into the group and dissolves its old group', async () => {
      const { service, groupRepo, taskRepo } = build();
      groupRepo.findOne.mockResolvedValue({ group_id: 'g1', event_id: 'e1' });
      taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        group_id: 'gOld',
      });
      taskRepo.count.mockResolvedValue(1); // gOld now too small

      const res = await service.addToGroup('g1', 't1');

      expect(res).toEqual({ group_id: 'g1' });
      expect(taskRepo.update).toHaveBeenCalledWith('t1', { group_id: 'g1' });
      expect(groupRepo.delete).toHaveBeenCalledWith('gOld');
    });

    it('moves the task with no prior group (nothing to dissolve)', async () => {
      const { service, groupRepo, taskRepo } = build();
      groupRepo.findOne.mockResolvedValue({ group_id: 'g1', event_id: 'e1' });
      taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        group_id: null,
      });

      await service.addToGroup('g1', 't1');

      expect(taskRepo.update).toHaveBeenCalledWith('t1', { group_id: 'g1' });
      expect(groupRepo.delete).not.toHaveBeenCalled();
      expect(taskRepo.count).not.toHaveBeenCalled();
    });
  });

  // ── ungroup ────────────────────────────────────────────────
  describe('ungroup', () => {
    it('returns ok immediately when the task has no group', async () => {
      const { service, taskRepo } = build();
      taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        group_id: null,
      });

      const res = await service.ungroup('t1');

      expect(res).toEqual({ ok: true });
      expect(taskRepo.update).not.toHaveBeenCalled();
    });

    it('clears the group_id and dissolves the old group when too small', async () => {
      const { service, taskRepo, groupRepo } = build();
      taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        group_id: 'g1',
      });
      taskRepo.count.mockResolvedValue(1);

      const res = await service.ungroup('t1');

      expect(res).toEqual({ ok: true });
      expect(taskRepo.update).toHaveBeenCalledWith('t1', { group_id: null });
      expect(groupRepo.delete).toHaveBeenCalledWith('g1');
    });

    it('clears the group_id but keeps a group that still has >= 2 members', async () => {
      const { service, taskRepo, groupRepo } = build();
      taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        group_id: 'g1',
      });
      taskRepo.count.mockResolvedValue(2);

      await service.ungroup('t1');

      expect(taskRepo.update).toHaveBeenCalledWith('t1', { group_id: null });
      expect(groupRepo.delete).not.toHaveBeenCalled();
    });
  });

  // ── renameGroup ────────────────────────────────────────────
  describe('renameGroup', () => {
    it('throws NotFound when the group is missing', async () => {
      const { service, groupRepo } = build();
      groupRepo.findOne.mockResolvedValue(null);

      await expect(service.renameGroup('gX', 'Title')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates the title and returns the reloaded group', async () => {
      const { service, groupRepo } = build();
      const reloaded = { group_id: 'g1', event_id: 'e1', title: 'Phase 1' };
      groupRepo.findOne
        .mockResolvedValueOnce({ group_id: 'g1', event_id: 'e1', title: '' })
        .mockResolvedValueOnce(reloaded);

      const res = await service.renameGroup('g1', 'Phase 1');

      expect(groupRepo.update).toHaveBeenCalledWith('g1', { title: 'Phase 1' });
      expect(res).toBe(reloaded);
    });

    it('truncates a title longer than 255 chars', async () => {
      const { service, groupRepo } = build();
      const long = 'x'.repeat(300);
      groupRepo.findOne
        .mockResolvedValueOnce({ group_id: 'g1', event_id: 'e1', title: '' })
        .mockResolvedValueOnce({ group_id: 'g1' });

      await service.renameGroup('g1', long);

      const patch = groupRepo.update.mock.calls[0][1];
      expect(patch.title).toHaveLength(255);
    });
  });

  // ── assignUser — happy path ────────────────────────────────
  describe('assignUser — happy path', () => {
    it('validates, saves the assignment, and notifies the user', async () => {
      const { service, taskRepo, assignRepo, userRepo, notifications } =
        build();
      userRepo.findOne.mockResolvedValue({
        user_id: 's1',
        role: 'staff',
        manager_id: 'me',
      });
      taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        task_name: 'Setup',
      });
      assignRepo.save.mockResolvedValue({ task_id: 't1', user_id: 's1' });

      const res = await service.assignUser('t1', 's1', {
        sub: 'me',
        role: 'manager',
      });

      expect(assignRepo.save).toHaveBeenCalled();
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        's1',
        'task',
        expect.stringContaining('Setup'),
        't1',
      );
      expect(res).toEqual({ task_id: 't1', user_id: 's1' });
    });
  });

  // ── setAssignees — diff & dedupe ───────────────────────────
  describe('setAssignees — diff and dedupe', () => {
    it('notifies only newly-added and only removed users, de-duping input', async () => {
      const { service, taskRepo, assignRepo, userRepo, notifications } =
        build();
      taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        task_name: 'Setup',
      });
      // Every target validates as assignable staff.
      userRepo.findOne.mockResolvedValue({ user_id: 'x', role: 'staff' });
      // Current assignees: s1 and s2.
      assignRepo.find.mockResolvedValue([{ user_id: 's1' }, { user_id: 's2' }]);

      // New set (with a duplicate s1): keep s1, drop s2, add s3.
      await service.setAssignees('t1', ['s1', 's1', 's3']);

      // Only s3 is newly added.
      expect(notifications.notifyUsers).toHaveBeenNthCalledWith(
        1,
        ['s3'],
        'task',
        expect.stringContaining('assigned'),
        't1',
      );
      // Only s2 is removed.
      expect(notifications.notifyUsers).toHaveBeenNthCalledWith(
        2,
        ['s2'],
        'task',
        expect.stringContaining('removed'),
        't1',
      );
      // De-dupe: s1 saved once, plus s3 → 2 saves total.
      expect(assignRepo.save).toHaveBeenCalledTimes(2);
    });
  });

  // ── assertStatusChangeAllowed — forward rules (via update) ──
  describe('assertStatusChangeAllowed — assigned non-creator forward rules', () => {
    function stubEventSideEffects(ctx: ReturnType<typeof build>) {
      // After the permission check, update() runs recomputeEventStatus +
      // recomputeAutoPriorities + findOne. Keep them from crashing.
      ctx.eventRepo.findOne.mockResolvedValue({
        event_id: 'e1',
        event_name: 'E',
        status: 'in_progress',
      });
      ctx.taskRepo.find.mockResolvedValue([]);
    }

    it('allows an assigned non-creator to move pending -> in_progress', async () => {
      const ctx = build();
      ctx.taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        status: 'pending',
        created_by: 'owner',
      });
      ctx.assignRepo.find.mockResolvedValue([{ user_id: 'staffer' }]);
      stubEventSideEffects(ctx);

      await expect(
        ctx.service.update(
          't1',
          { status: 'in_progress' },
          { sub: 'staffer', role: 'staff' },
        ),
      ).resolves.toBeDefined();
      expect(ctx.taskRepo.update).toHaveBeenCalled();
    });

    it('allows an assigned non-creator to move in_progress -> completed', async () => {
      const ctx = build();
      ctx.taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        status: 'in_progress',
        created_by: 'owner',
      });
      ctx.assignRepo.find.mockResolvedValue([{ user_id: 'staffer' }]);
      stubEventSideEffects(ctx);

      await expect(
        ctx.service.update(
          't1',
          { status: 'completed' },
          { sub: 'staffer', role: 'staff' },
        ),
      ).resolves.toBeDefined();
    });

    it('blocks an assigned non-creator from moving in_progress -> pending (backwards)', async () => {
      const ctx = build();
      ctx.taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        status: 'in_progress',
        created_by: 'owner',
      });
      ctx.assignRepo.find.mockResolvedValue([{ user_id: 'staffer' }]);

      await expect(
        ctx.service.update(
          't1',
          { status: 'pending' },
          { sub: 'staffer', role: 'staff' },
        ),
      ).rejects.toThrow(/can only move a task forward/);
    });

    it('lets the creator make a backward transition (in_progress -> pending)', async () => {
      const ctx = build();
      ctx.taskRepo.findOne.mockResolvedValue({
        task_id: 't1',
        event_id: 'e1',
        status: 'in_progress',
        created_by: 'owner',
      });
      ctx.assignRepo.find.mockResolvedValue([]);
      stubEventSideEffects(ctx);

      await expect(
        ctx.service.update(
          't1',
          { status: 'pending' },
          { sub: 'owner', role: 'manager' },
        ),
      ).resolves.toBeDefined();
    });
  });
});
