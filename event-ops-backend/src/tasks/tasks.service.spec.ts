import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';

// Minimal repo/dependency doubles. Each test wires only the methods it needs.
function makeRepo() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve({ task_id: 't-new', ...x })),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    manager: { query: jest.fn() },
  };
}

function build() {
  const taskRepo = makeRepo();
  const assignRepo = makeRepo();
  const depRepo = makeRepo();
  const groupRepo = makeRepo();
  const logRepo = makeRepo();
  const userRepo = makeRepo();
  const eventRepo = makeRepo();
  const gateway = { broadcast: jest.fn(), sendToUser: jest.fn(), broadcastToEvent: jest.fn() };
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
    depRepo as never,
    groupRepo as never,
    logRepo as never,
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
    userRepo,
    eventRepo,
    gateway,
    notifications,
    events,
  };
}

describe('TasksService', () => {
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
  });

  describe('recomputeAutoPriorities — timeline bucketing', () => {
    it('buckets auto tasks into high/medium/low across the timeline thirds', async () => {
      const { service, taskRepo } = build();
      // Three tasks spanning a 3-day window: earliest=high, mid=medium, late=low.
      taskRepo.find.mockResolvedValue([
        {
          task_id: 'a',
          priority_source: 'auto',
          deadline: '2026-06-01T00:00:00Z',
        },
        {
          task_id: 'b',
          priority_source: 'auto',
          deadline: '2026-06-02T12:00:00Z',
        },
        {
          task_id: 'c',
          priority_source: 'auto',
          deadline: '2026-06-04T00:00:00Z',
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
      events.assertCanViewEvent.mockRejectedValue(new BadRequestException('no'));
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
      const r = await service.findOneForViewer('t1', { sub: 'm', role: 'manager' });
      expect((r as { task_id: string }).task_id).toBe('t1');
    });

    it('getAssignmentsForViewer enforces event visibility before reading rows', async () => {
      const { service, taskRepo, assignRepo, events } = build();
      taskRepo.findOne.mockResolvedValue({ task_id: 't1', event_id: 'e1' });
      events.assertCanViewEvent.mockRejectedValue(new BadRequestException('no'));
      await expect(
        service.getAssignmentsForViewer('t1', { sub: 'outsider', role: 'staff' }),
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
