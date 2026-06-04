import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Event } from '../entities/event.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsGateway } from '../websocket/events.gateway';
import { TasksService } from '../tasks/tasks.service';

interface Viewer {
  sub: string;
  role: string;
}

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(Event)
    private readonly eventRepo: Repository<Event>,
    private readonly notifications: NotificationsService,
    private readonly gateway: EventsGateway,
    // forwardRef: TasksService also depends on EventsService (event-membership
    // policy), so the two form a cycle. Used to re-bucket auto priorities after
    // an event's dates change.
    @Inject(forwardRef(() => TasksService))
    private readonly tasks: TasksService,
  ) {}

  // Tell the event's members something changed so they can refetch live.
  private broadcastChange(eventId?: string) {
    this.gateway.broadcastToEvent(eventId, 'data_changed', {
      kind: 'event',
      event_id: eventId,
    });
  }

  // All member user ids of an event: the member managers + all of their staff.
  async getMemberIds(eventId: string): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.eventRepo.manager.query(
      `SELECT em.manager_id AS id FROM event_managers em WHERE em.event_id = $1
       UNION
       SELECT u.user_id AS id FROM users u
         WHERE u.role = 'staff'
           AND u.manager_id IN (SELECT manager_id FROM event_managers WHERE event_id = $1)`,
      [eventId],
    );
    return rows.map((r) => r.id);
  }

  // The member ids a single manager contributes: the manager + their staff.
  async getManagerMemberIds(managerId: string): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.eventRepo.manager.query(
      `SELECT $1::uuid AS id
       UNION
       SELECT user_id FROM users WHERE role = 'staff' AND manager_id = $1`,
      [managerId],
    );
    return rows.map((r) => r.id);
  }

  // ── Access policy ──────────────────────────────────────────
  // Central authorization helpers so every event/task/membership route shares
  // the same membership rules instead of trusting raw IDs.

  // True when the manager is a member of the event.
  async isEventMember(managerId: string, eventId: string): Promise<boolean> {
    const rows: unknown[] = await this.eventRepo.manager.query(
      `SELECT 1 FROM event_managers WHERE event_id = $1 AND manager_id = $2 LIMIT 1`,
      [eventId, managerId],
    );
    return rows.length > 0;
  }

  // May this actor WRITE within the event (create/edit/assign/delete tasks)?
  //   admin / organizer: any event; manager: only events they belong to;
  //   staff: never.
  async canManageEvent(actor: Viewer, eventId: string): Promise<boolean> {
    if (!actor) return false;
    if (actor.role === 'admin' || actor.role === 'organizer') return true;
    if (actor.role === 'manager') return this.isEventMember(actor.sub, eventId);
    return false;
  }

  async assertCanManageEvent(actor: Viewer, eventId: string): Promise<void> {
    // Surface a 404 for a non-existent event rather than leaking existence
    // through a 403, then enforce membership.
    await this.findOne(eventId);
    if (!(await this.canManageEvent(actor, eventId))) {
      throw new ForbiddenException(
        'You do not manage this event / Bạn không quản lý sự kiện này',
      );
    }
  }

  // May this actor VIEW the event and its tasks/members?
  //   admin / organizer: any; manager: member; staff: their manager is one.
  async canViewEvent(actor: Viewer, eventId: string): Promise<boolean> {
    if (!actor) return false;
    if (actor.role === 'admin' || actor.role === 'organizer') return true;
    if (actor.role === 'manager') return this.isEventMember(actor.sub, eventId);
    if (actor.role === 'staff') {
      const rows: unknown[] = await this.eventRepo.manager.query(
        `SELECT 1 FROM event_managers em
           WHERE em.event_id = $1
             AND em.manager_id = (SELECT manager_id FROM users WHERE user_id = $2)
           LIMIT 1`,
        [eventId, actor.sub],
      );
      return rows.length > 0;
    }
    return false;
  }

  async assertCanViewEvent(actor: Viewer, eventId: string): Promise<void> {
    await this.findOne(eventId);
    if (!(await this.canViewEvent(actor, eventId))) {
      throw new ForbiddenException(
        'You do not have access to this event / Bạn không có quyền truy cập sự kiện này',
      );
    }
  }

  // Viewer-scoped single-event read (GET /events/:id) — same visibility as the
  // list, so a raw ID can't fetch an event outside the viewer's scope.
  async findOneForViewer(id: string, viewer: Viewer) {
    await this.assertCanViewEvent(viewer, id);
    return this.findOne(id);
  }

  // Viewer-scoped membership read (GET /events/:id/managers).
  async getEventManagersForViewer(id: string, viewer: Viewer) {
    await this.assertCanViewEvent(viewer, id);
    return this.getEventManagers(id);
  }

  // Events visible to the viewer, each with manager + total people counts.
  //   admin / organizer: all events
  //   manager: events they are a member of
  //   staff:   events their manager is a member of
  async findForViewer(viewer: Viewer) {
    const m = this.eventRepo.manager;
    let where = 'TRUE';
    const params: string[] = [];
    if (viewer.role === 'manager') {
      where =
        'EXISTS (SELECT 1 FROM event_managers em WHERE em.event_id = e.event_id AND em.manager_id = $1)';
      params.push(viewer.sub);
    } else if (viewer.role === 'staff') {
      where =
        'EXISTS (SELECT 1 FROM event_managers em WHERE em.event_id = e.event_id AND em.manager_id = (SELECT manager_id FROM users WHERE user_id = $1))';
      params.push(viewer.sub);
    }
    const rows: Array<Record<string, unknown>> = await m.query(
      `SELECT e.*,
         (SELECT count(*)::int FROM event_managers em WHERE em.event_id = e.event_id) AS manager_count,
         (SELECT count(*)::int FROM event_managers em WHERE em.event_id = e.event_id)
           + (SELECT count(*)::int FROM users u WHERE u.role = 'staff'
                AND u.manager_id IN (SELECT manager_id FROM event_managers em2 WHERE em2.event_id = e.event_id)) AS people_count,
         (SELECT count(*)::int FROM tasks t WHERE t.event_id = e.event_id) AS task_count,
         (SELECT count(*)::int FROM tasks t WHERE t.event_id = e.event_id AND t.status = 'completed') AS completed_count
       FROM events e
       WHERE ${where}
       ORDER BY e.start_time ASC`,
      params,
    );
    return rows;
  }

  async findOne(id: string) {
    const event = await this.eventRepo.findOne({ where: { event_id: id } });
    if (!event) throw new NotFoundException(`Event ${id} not found`);
    return event;
  }

  // Managers an organizer can choose from, with their team sizes.
  availableManagers(): Promise<unknown[]> {
    return this.eventRepo.manager.query(
      `SELECT u.user_id, u.name, u.email,
         (SELECT count(*)::int FROM users s WHERE s.role = 'staff' AND s.manager_id = u.user_id) AS team_count
       FROM users u
       WHERE u.role = 'manager' AND u.is_active = true
       ORDER BY u.name ASC`,
    );
  }

  // Managers currently in an event (for the membership editor / display).
  getEventManagers(eventId: string): Promise<unknown[]> {
    return this.eventRepo.manager.query(
      `SELECT u.user_id, u.name, u.email,
         (SELECT count(*)::int FROM users s WHERE s.role = 'staff' AND s.manager_id = u.user_id) AS team_count
       FROM event_managers em JOIN users u ON u.user_id = em.manager_id
       WHERE em.event_id = $1
       ORDER BY u.name ASC`,
      [eventId],
    );
  }

  async create(data: Partial<Event>, managerIds: string[] = []) {
    if (!data.event_name || !data.start_time || !data.end_time) {
      throw new BadRequestException(
        'Event name, start time and end time are required / Vui lòng nhập tên sự kiện, thời gian bắt đầu và kết thúc',
      );
    }
    this.assertValidDateRange(data.start_time, data.end_time);
    // Save the event and attach its initial managers atomically — a failure
    // partway through the manager list can't leave a half-populated event.
    // Each manager id is validated (active 'manager') inside the transaction.
    const event = await this.eventRepo.manager.transaction(async (em) => {
      const saved = await em.save(em.create(Event, data));
      for (const mid of managerIds) {
        const rows: Array<{ role: string; is_active: boolean }> = await em.query(
          `SELECT role, is_active FROM users WHERE user_id = $1`,
          [mid],
        );
        const target = rows[0];
        if (!target || target.role !== 'manager' || !target.is_active) {
          throw new BadRequestException(
            'Only an active manager can be added to an event / Chỉ có thể thêm quản lý đang hoạt động vào sự kiện',
          );
        }
        await em.query(
          `INSERT INTO event_managers (event_id, manager_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [saved.event_id, mid],
        );
      }
      return saved;
    });
    // Notify everyone who just became a member (managers + their staff) — after commit.
    const members = await this.getMemberIds(event.event_id);
    await this.notifications.notifyUsers(
      members,
      'event',
      `You were added to the event "${event.event_name}". / Bạn đã được thêm vào sự kiện "${event.event_name}".`,
    );
    this.broadcastChange(event.event_id);
    return this.findOne(event.event_id);
  }

  // notify=true is used by the membership editor (a manager added after the
  // event exists); create() inserts in bulk and notifies the whole set itself.
  async addManager(eventId: string, managerId: string, notify = false) {
    // Only an active user with the 'manager' role may be added — membership and
    // headcount queries assume manager rows + their staff, so staff/admins/event
    // managers must never land in event_managers.
    const rows: Array<{ role: string; is_active: boolean }> =
      await this.eventRepo.manager.query(
        `SELECT role, is_active FROM users WHERE user_id = $1`,
        [managerId],
      );
    const target = rows[0];
    if (!target || target.role !== 'manager' || !target.is_active) {
      throw new BadRequestException(
        'Only an active manager can be added to an event / Chỉ có thể thêm quản lý đang hoạt động vào sự kiện',
      );
    }
    await this.eventRepo.manager.query(
      `INSERT INTO event_managers (event_id, manager_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [eventId, managerId],
    );
    if (notify) {
      const event = await this.findOne(eventId);
      const added = await this.getManagerMemberIds(managerId);
      await this.notifications.notifyUsers(
        added,
        'event',
        `You were added to the event "${event.event_name}". / Bạn đã được thêm vào sự kiện "${event.event_name}".`,
      );
      this.broadcastChange(eventId);
    }
    return this.getEventManagers(eventId);
  }

  async removeManager(eventId: string, managerId: string) {
    const event = await this.findOne(eventId);
    const removed = await this.getManagerMemberIds(managerId);
    await this.eventRepo.manager.query(
      `DELETE FROM event_managers WHERE event_id = $1 AND manager_id = $2`,
      [eventId, managerId],
    );
    await this.notifications.notifyUsers(
      removed,
      'event',
      `You were removed from the event "${event.event_name}". / Bạn đã bị gỡ khỏi sự kiện "${event.event_name}".`,
    );
    this.broadcastChange(eventId);
    return this.getEventManagers(eventId);
  }

  async update(id: string, data: Partial<Event>) {
    await this.findOne(id);
    this.assertValidDateRange(data.start_time, data.end_time);
    await this.eventRepo.update(id, data);
    this.broadcastChange(id);
    return this.findOne(id);
  }

  // Change an event's dates. The caller chooses what happens to its tasks:
  //   'delete' — remove all tasks.
  //   'shift'  — move every task by the same offset the event start moved;
  //              any task whose shifted deadline lands past the new end is deleted.
  async updateDates(
    id: string,
    start_time: string,
    end_time: string,
    strategy: 'delete' | 'shift',
  ) {
    const event = await this.findOne(id);
    if (!start_time || !end_time) {
      throw new BadRequestException(
        'Start and end time are required / Vui lòng nhập thời gian bắt đầu và kết thúc',
      );
    }
    const newStart = new Date(start_time);
    const newEnd = new Date(end_time);
    this.assertValidDateRange(newStart, newEnd);
    const delta = newStart.getTime() - new Date(event.start_time).getTime();

    // Re-time/delete tasks and re-derive the event status atomically — a failure
    // partway can't leave a half-shifted task set with a stale event status.
    await this.eventRepo.manager.transaction(async (em) => {
      if (strategy === 'delete') {
        const rows: Array<{ task_id: string }> = await em.query(
          `SELECT task_id FROM tasks WHERE event_id = $1`,
          [id],
        );
        for (const { task_id } of rows) await this.deleteTaskRow(task_id, em);
      } else {
        // shift
        const rows: Array<{
          task_id: string;
          start_time: Date | null;
          deadline: Date | null;
        }> = await em.query(
          `SELECT task_id, start_time, deadline FROM tasks WHERE event_id = $1`,
          [id],
        );
        for (const tk of rows) {
          const shiftedDeadline = tk.deadline
            ? new Date(new Date(tk.deadline).getTime() + delta)
            : null;
          const shiftedStart = tk.start_time
            ? new Date(new Date(tk.start_time).getTime() + delta)
            : null;
          if (shiftedDeadline && shiftedDeadline > newEnd) {
            await this.deleteTaskRow(tk.task_id, em);
          } else {
            await em.query(
              `UPDATE tasks SET start_time = $2, deadline = $3 WHERE task_id = $1`,
              [tk.task_id, shiftedStart, shiftedDeadline],
            );
          }
        }
      }

      // Re-derive status from whatever tasks remain.
      const remaining: Array<{ status: string }> = await em.query(
        `SELECT status FROM tasks WHERE event_id = $1`,
        [id],
      );
      let status = 'pending';
      if (remaining.length > 0) {
        status = remaining.every((t) => t.status === 'completed')
          ? 'completed'
          : 'in_progress';
      }
      await em.update(Event, id, { start_time, end_time, status });
    });

    // After commit: re-bucket auto priorities for the new window (#7), then
    // notify members and broadcast.
    await this.tasks.recomputeAutoPriorities(id);

    const members = await this.getMemberIds(id);
    await this.notifications.notifyUsers(
      members,
      'event',
      `The event "${event.event_name}" dates were updated. / Sự kiện "${event.event_name}" đã được đổi thời gian.`,
      null,
      id,
    );
    this.broadcastChange(id);
    return this.findOne(id);
  }

  // Delete a task and all of its child rows. ON DELETE CASCADE handles these
  // once the FK migration (npm run db:migrate) is applied; we still clear them
  // by hand as a fallback for databases created before that migration.
  private async deleteTaskRow(
    taskId: string,
    m: EntityManager = this.eventRepo.manager,
  ) {
    await m.query('DELETE FROM ai_task_map WHERE task_id = $1', [taskId]);
    await m.query(
      'DELETE FROM task_dependencies WHERE task_id = $1 OR depends_on_task = $1',
      [taskId],
    );
    await m.query('DELETE FROM task_logs WHERE task_id = $1', [taskId]);
    await m.query('DELETE FROM task_assignments WHERE task_id = $1', [taskId]);
    await m.query('DELETE FROM notifications WHERE task_id = $1', [taskId]);
    await m.query('DELETE FROM tasks WHERE task_id = $1', [taskId]);
  }

  // The end time must come after the start time (also enforced by a DB CHECK).
  private assertValidDateRange(start?: Date, end?: Date) {
    if (start && end && new Date(end) <= new Date(start)) {
      throw new BadRequestException(
        'End time must be after start time / Thời gian kết thúc phải sau thời gian bắt đầu',
      );
    }
  }

  async remove(id: string) {
    const event = await this.findOne(id);
    // Capture members before the event_managers rows cascade away on delete.
    const members = await this.getMemberIds(id);
    // event_managers has ON DELETE CASCADE; tasks reference the event, so clear
    // tasks (and their children) first.
    const m = this.eventRepo.manager;
    const taskRows: Array<{ task_id: string }> = await m.query(
      `SELECT task_id FROM tasks WHERE event_id = $1`,
      [id],
    );
    for (const { task_id } of taskRows) await this.deleteTaskRow(task_id);
    await this.eventRepo.delete(id);
    await this.notifications.notifyUsers(
      members,
      'event',
      `The event "${event.event_name}" was deleted. / Sự kiện "${event.event_name}" đã bị xóa.`,
    );
    this.broadcastChange(id);
    return { message: 'Event deleted' };
  }
}
