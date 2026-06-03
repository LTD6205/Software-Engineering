import { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { createTestApp } from './utils';
import { EventsService } from '../src/events/events.service';
import { TasksService } from '../src/tasks/tasks.service';
import { UsersService } from '../src/users/users.service';
import { NotificationsService } from '../src/notifications/notifications.service';

// Integration tests for the hand-written raw SQL paths that the unit specs
// can't meaningfully cover (they run against the real test Postgres):
//   EventsService.getMemberIds / getManagerMemberIds / findForViewer / getEventManagers
//   TasksService.findAllByEvent (assignee + group joins)
//   NotificationsService.deadlineRecipients
//   UsersService.incomingReassignRequests
// A small, deterministic fixture is built in beforeAll and torn down after.
describe('Raw SQL integration (e2e)', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let moduleRef: TestingModule;
  let ds: DataSource;
  let events: EventsService;
  let tasks: TasksService;
  let users: UsersService;
  let notifications: NotificationsService;

  let emId: string; // organizer01 (event creator)
  let mgrId: string; // manager01 (member)
  let staffId: string; // staff01 (reports to manager01, assigned to the task)
  let pendingStaffId: string; // staff02 (a pending reassignment to manager01)
  let eventId: string;
  let taskId: string;

  const idByEmail = async (email: string): Promise<string> => {
    const rows: Array<{ user_id: string }> = await ds.query(
      'SELECT user_id FROM users WHERE email = $1',
      [email],
    );
    return rows[0].user_id;
  };

  beforeAll(async () => {
    ({ app, moduleRef } = await createTestApp());
    ds = moduleRef.get(DataSource, { strict: false });
    events = moduleRef.get(EventsService, { strict: false });
    tasks = moduleRef.get(TasksService, { strict: false });
    users = moduleRef.get(UsersService, { strict: false });
    notifications = moduleRef.get(NotificationsService, { strict: false });

    emId = await idByEmail('organizer01@eventops.com');
    mgrId = await idByEmail('manager01@eventops.com');
    staffId = await idByEmail('staff01@eventops.com');
    pendingStaffId = await idByEmail('staff02@eventops.com');

    // Deterministic ownership: staff01 reports to manager01; staff02 has a
    // pending move INTO manager01's team.
    await ds.query(
      `UPDATE users SET manager_id = $1, pending_manager_id = NULL WHERE user_id = $2`,
      [mgrId, staffId],
    );
    await ds.query(
      `UPDATE users SET pending_manager_id = $1 WHERE user_id = $2`,
      [mgrId, pendingStaffId],
    );

    // An event owned by the organizer with manager01 as a member.
    const ev = await events.create(
      {
        event_name: `RAWSQL Fixture ${Date.now()}`,
        start_time: new Date('2026-10-01T09:00:00Z'),
        end_time: new Date('2026-10-05T18:00:00Z'),
        created_by: emId,
      },
      [mgrId],
    );
    eventId = ev.event_id;

    // A task in that event, assigned to staff01.
    const tk = await tasks.create({
      event_id: eventId,
      task_name: 'RAWSQL fixture task',
      created_by: emId,
      start_time: new Date('2026-10-02T09:00:00Z'),
      deadline: new Date('2026-10-03T09:00:00Z'),
    });
    taskId = tk.task_id;
    await tasks.setAssignees(taskId, [staffId], {
      sub: emId,
      role: 'organizer',
    });
  });

  afterAll(async () => {
    // Tear down the fixture (event delete cascades members + the task).
    if (eventId) await events.remove(eventId).catch(() => undefined);
    await ds
      .query(`UPDATE users SET pending_manager_id = NULL WHERE user_id = $1`, [
        pendingStaffId,
      ])
      .catch(() => undefined);
    await app.close();
    await moduleRef.close();
  });

  describe('EventsService.getManagerMemberIds', () => {
    it('returns the manager plus their staff', async () => {
      const ids = await events.getManagerMemberIds(mgrId);
      expect(ids).toContain(mgrId);
      expect(ids).toContain(staffId);
    });
  });

  describe('EventsService.getMemberIds', () => {
    it('unions the member managers with all of their staff', async () => {
      const ids = await events.getMemberIds(eventId);
      expect(ids).toContain(mgrId);
      expect(ids).toContain(staffId);
    });
  });

  describe('EventsService.getEventManagers', () => {
    it('lists the member managers with a team_count', async () => {
      const rows = (await events.getEventManagers(eventId)) as Array<{
        user_id: string;
        team_count: number;
      }>;
      const row = rows.find((r) => r.user_id === mgrId);
      expect(row).toBeDefined();
      expect(typeof row!.team_count).toBe('number');
    });
  });

  describe('EventsService.findForViewer', () => {
    it('a member manager sees the event with headcounts', async () => {
      const rows = (await events.findForViewer({
        sub: mgrId,
        role: 'manager',
      })) as Array<{
        event_id: string;
        manager_count: number;
        people_count: number;
      }>;
      const row = rows.find((e) => e.event_id === eventId);
      expect(row).toBeDefined();
      expect(row!.manager_count).toBeGreaterThanOrEqual(1);
      // people_count = managers + their staff, so it exceeds manager_count here.
      expect(row!.people_count).toBeGreaterThanOrEqual(row!.manager_count);
    });

    it('a staff member sees the event their manager belongs to', async () => {
      const rows = (await events.findForViewer({
        sub: staffId,
        role: 'staff',
      })) as Array<{ event_id: string }>;
      expect(rows.map((e) => e.event_id)).toContain(eventId);
    });

    it('an admin sees the event (unfiltered)', async () => {
      const rows = (await events.findForViewer({
        sub: emId,
        role: 'admin',
      })) as Array<{ event_id: string }>;
      expect(rows.map((e) => e.event_id)).toContain(eventId);
    });
  });

  describe('TasksService.findAllByEvent (assignee join)', () => {
    it('attaches the assignee details to the task', async () => {
      const rows = (await tasks.findAllByEvent(eventId)) as unknown as Array<{
        task_id: string;
        assignees: Array<{ user_id: string }>;
      }>;
      const row = rows.find((t) => t.task_id === taskId);
      expect(row).toBeDefined();
      expect(row!.assignees.map((a) => a.user_id)).toContain(staffId);
    });

    it('a staff viewer only sees tasks they are assigned to', async () => {
      const rows = (await tasks.findAllByEvent(eventId, {
        sub: staffId,
        role: 'staff',
      })) as Array<{ task_id: string }>;
      expect(rows.map((t) => t.task_id)).toContain(taskId);
    });
  });

  describe('NotificationsService.deadlineRecipients', () => {
    it('unions the assignee, their manager, and the event creator', async () => {
      // private method — exercised directly against the real join.
      const recipients: string[] = await (
        notifications as unknown as {
          deadlineRecipients(id: string): Promise<string[]>;
        }
      ).deadlineRecipients(taskId);
      expect(recipients).toEqual(
        expect.arrayContaining([staffId, mgrId, emId]),
      );
    });
  });

  describe('UsersService.incomingReassignRequests', () => {
    it('lists staff with a pending move addressed to the manager', async () => {
      const rows = (await users.incomingReassignRequests(mgrId)) as Array<{
        user_id: string;
        current_manager_id: string | null;
      }>;
      expect(rows.map((r) => r.user_id)).toContain(pendingStaffId);
    });
  });
});
