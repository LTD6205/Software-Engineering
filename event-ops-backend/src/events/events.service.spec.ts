import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventsService } from './events.service';

function makeRepo() {
  // Default raw-query result is an empty array so helpers like getMemberIds
  // (which .map() the rows) work even when a test doesn't stub the SQL.
  const manager: Record<string, jest.Mock> = {
    query: jest.fn().mockResolvedValue([]),
  };
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve({ event_id: 'e-new', ...x })),
    update: jest.fn(),
    delete: jest.fn(),
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
  const eventRepo = makeRepo();
  const notifications = { notifyUsers: jest.fn(), notifyUser: jest.fn() };
  const gateway = {
    broadcast: jest.fn(),
    sendToUser: jest.fn(),
    broadcastToEvent: jest.fn(),
    addUsersToEventRoom: jest.fn(),
    removeUsersFromEventRoom: jest.fn(),
  };
  // EventsService calls back into TasksService to re-bucket priorities after a
  // date change (#7); mocked here.
  const tasks = { recomputeAutoPriorities: jest.fn() };
  const service = new EventsService(
    eventRepo as never,
    notifications as never,
    gateway as never,
    tasks as never,
  );
  return { service, eventRepo, notifications, gateway, tasks };
}

describe('EventsService', () => {
  describe('create — validation', () => {
    it('rejects an event missing name/start/end', async () => {
      const { service } = build();
      await expect(service.create({ event_name: 'X' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an end time that is not after the start time', async () => {
      const { service } = build();
      await expect(
        service.create({
          event_name: 'X',
          start_time: new Date('2026-06-10T10:00:00Z'),
          end_time: new Date('2026-06-10T09:00:00Z'),
        }),
      ).rejects.toThrow(/End time must be after/);
    });

    it('rejects an event whose end is in the past (already finished)', async () => {
      const { service } = build();
      const DAY = 24 * 60 * 60 * 1000;
      await expect(
        service.create({
          event_name: 'X',
          start_time: new Date(Date.now() - 5 * DAY),
          end_time: new Date(Date.now() - DAY),
        }),
      ).rejects.toThrow(/at least one day from now/);
    });

    it('allows a start in the past as long as the end is at least a day out', async () => {
      const { service, eventRepo } = build();
      const DAY = 24 * 60 * 60 * 1000;
      eventRepo.findOne.mockResolvedValue({ event_id: 'e-new', event_name: 'X' });
      eventRepo.manager.query.mockResolvedValue([]);
      await service.create({
        event_name: 'X',
        start_time: new Date(Date.now() - 5 * DAY), // past start — allowed
        end_time: new Date(Date.now() + 2 * DAY), // end 2 days out
      });
      expect(eventRepo.save).toHaveBeenCalled();
    });

    it('creates the event and notifies the initial members', async () => {
      const { service, eventRepo, notifications } = build();
      eventRepo.findOne.mockResolvedValue({
        event_id: 'e-new',
        event_name: 'X',
      });
      // create validates each manager is an active manager WITH active staff
      // (the staff_count query), then INSERTs; getMemberIds SELECTs the ids.
      eventRepo.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('staff_count'))
          return Promise.resolve([
            { role: 'manager', is_active: true, staff_count: 2 },
          ]);
        if (sql.trim().startsWith('INSERT')) return Promise.resolve(undefined);
        return Promise.resolve([{ id: 'm1' }, { id: 's1' }]);
      });

      await service.create(
        {
          event_name: 'X',
          start_time: new Date(Date.now() + 24 * 60 * 60 * 1000),
          end_time: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        },
        ['m1'],
      );

      expect(eventRepo.save).toHaveBeenCalled();
      expect(notifications.notifyUsers).toHaveBeenCalledWith(
        ['m1', 's1'],
        'event',
        expect.stringContaining('added to the event'),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFound for a missing event', async () => {
      const { service, eventRepo } = build();
      eventRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('addManager — target validation', () => {
    it('rejects adding a user who is not an active manager', async () => {
      const { service, eventRepo } = build();
      // The eligibility lookup returns a staff member, not a manager.
      eventRepo.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('staff_count'))
          return Promise.resolve([
            { role: 'staff', is_active: true, staff_count: 0 },
          ]);
        return Promise.resolve([]);
      });
      await expect(service.addManager('e1', 'staff-x')).rejects.toThrow(
        /active manager/,
      );
    });

    it('rejects adding an inactive manager', async () => {
      const { service, eventRepo } = build();
      eventRepo.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('staff_count'))
          return Promise.resolve([
            { role: 'manager', is_active: false, staff_count: 3 },
          ]);
        return Promise.resolve([]);
      });
      await expect(service.addManager('e1', 'mgr-off')).rejects.toThrow(
        /active manager/,
      );
    });

    it('rejects adding a manager who has no active staff', async () => {
      const { service, eventRepo } = build();
      eventRepo.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('staff_count'))
          return Promise.resolve([
            { role: 'manager', is_active: true, staff_count: 0 },
          ]);
        return Promise.resolve([]);
      });
      await expect(service.addManager('e1', 'mgr-empty')).rejects.toThrow(
        /at least one staff member/,
      );
    });

    it('adds an eligible manager (active, with staff)', async () => {
      const { service, eventRepo } = build();
      eventRepo.findOne.mockResolvedValue({ event_id: 'e1', event_name: 'X' });
      eventRepo.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('staff_count'))
          return Promise.resolve([
            { role: 'manager', is_active: true, staff_count: 1 },
          ]);
        return Promise.resolve([]);
      });
      await expect(service.addManager('e1', 'mgr-ok')).resolves.toBeDefined();
    });
  });

  describe('create — manager eligibility', () => {
    it('rejects an initial manager who has no active staff', async () => {
      const { service, eventRepo } = build();
      eventRepo.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('staff_count'))
          return Promise.resolve([
            { role: 'manager', is_active: true, staff_count: 0 },
          ]);
        return Promise.resolve([]);
      });
      await expect(
        service.create(
          {
            event_name: 'X',
            start_time: new Date(Date.now() + 24 * 60 * 60 * 1000),
            end_time: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          },
          ['m-empty'],
        ),
      ).rejects.toThrow(/at least one staff member/);
    });
  });

  describe('access policy', () => {
    it('admins and organizers may manage any event', async () => {
      const { service } = build();
      expect(
        await service.canManageEvent({ sub: 'a', role: 'admin' }, 'e1'),
      ).toBe(true);
      expect(
        await service.canManageEvent({ sub: 'em', role: 'organizer' }, 'e1'),
      ).toBe(true);
    });

    it('a manager may manage only events they are a member of', async () => {
      const { service, eventRepo } = build();
      eventRepo.manager.query.mockResolvedValueOnce([{ '?column?': 1 }]); // member
      expect(
        await service.canManageEvent({ sub: 'm1', role: 'manager' }, 'e1'),
      ).toBe(true);
      eventRepo.manager.query.mockResolvedValueOnce([]); // not a member
      expect(
        await service.canManageEvent({ sub: 'm1', role: 'manager' }, 'e2'),
      ).toBe(false);
    });

    it('staff can never manage an event', async () => {
      const { service } = build();
      expect(
        await service.canManageEvent({ sub: 's1', role: 'staff' }, 'e1'),
      ).toBe(false);
    });

    it('assertCanManageEvent throws Forbidden for a non-member manager', async () => {
      const { service, eventRepo } = build();
      eventRepo.findOne.mockResolvedValue({ event_id: 'e1' }); // event exists
      eventRepo.manager.query.mockResolvedValue([]); // not a member
      await expect(
        service.assertCanManageEvent({ sub: 'm1', role: 'manager' }, 'e1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('findOneForViewer denies a manager who is not on the event', async () => {
      const { service, eventRepo } = build();
      eventRepo.findOne.mockResolvedValue({ event_id: 'e1' });
      eventRepo.manager.query.mockResolvedValue([]); // not a member
      await expect(
        service.findOneForViewer('e1', { sub: 'm1', role: 'manager' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update — name/description allowlist', () => {
    it('persists only event_name/description, ignoring date & server-owned fields', async () => {
      const { service, eventRepo } = build();
      eventRepo.findOne.mockResolvedValue({ event_id: 'e1' });
      // A caller tries to smuggle in server-owned and date fields; the service
      // must drop everything but name/description (dates go through updateDates).
      await service.update('e1', {
        event_name: 'New name',
        description: 'New desc',
        status: 'completed',
        created_by: 'someone-else',
        event_id: 'e2',
        start_time: new Date('2026-06-10T10:00:00Z'),
        end_time: new Date('2026-06-10T08:00:00Z'),
      } as never);
      expect(eventRepo.update).toHaveBeenCalledWith('e1', {
        event_name: 'New name',
        description: 'New desc',
      });
    });
  });

  describe('updateDates — shift strategy', () => {
    it('shifts task times by the same delta and drops tasks past the new end', async () => {
      const { service, eventRepo, tasks } = build();
      eventRepo.findOne.mockResolvedValue({
        event_id: 'e1',
        event_name: 'E',
        start_time: '2026-06-01T00:00:00Z',
      });
      // 1) SELECT tasks for shifting
      // one task fits, one lands past the new end and must be deleted.
      eventRepo.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT task_id, start_time, deadline')) {
          return Promise.resolve([
            {
              task_id: 'fits',
              start_time: '2026-06-02T00:00:00Z',
              deadline: '2026-06-03T00:00:00Z',
            },
            {
              task_id: 'overflows',
              start_time: '2026-06-09T00:00:00Z',
              deadline: '2026-06-10T00:00:00Z',
            },
          ]);
        }
        if (sql.startsWith('SELECT status')) {
          return Promise.resolve([{ status: 'in_progress' }]);
        }
        // getMemberIds and the per-task DELETE/UPDATE statements.
        return Promise.resolve([]);
      });

      // shift the event start forward 2 days; new end is +3 days from old start.
      await service.updateDates(
        'e1',
        '2026-06-03T00:00:00Z',
        '2026-06-05T00:00:00Z',
        'shift',
      );

      const calls = eventRepo.manager.query.mock.calls.map(
        (c) => c[0] as string,
      );
      // The fitting task gets an UPDATE; the overflowing one gets deleted.
      expect(
        calls.some((s) => s.startsWith('UPDATE tasks SET start_time')),
      ).toBe(true);
      expect(
        calls.some((s) => s.includes('DELETE FROM tasks WHERE task_id')),
      ).toBe(true);
      // #7: auto priorities are re-bucketed for the new window after the change.
      expect(tasks.recomputeAutoPriorities).toHaveBeenCalledWith('e1');
    });

    it('rejects missing start/end times', async () => {
      const { service, eventRepo } = build();
      eventRepo.findOne.mockResolvedValue({
        event_id: 'e1',
        start_time: '2026-06-01T00:00:00Z',
      });
      await expect(
        service.updateDates('e1', '', '2026-06-05T00:00:00Z', 'shift'),
      ).rejects.toThrow(/required/);
    });
  });
});
