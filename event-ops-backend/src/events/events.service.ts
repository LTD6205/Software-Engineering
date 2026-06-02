import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Event } from '../entities/event.entity';
import { NotificationsService } from '../notifications/notifications.service';

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
  ) {}

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

  // Events visible to the viewer, each with manager + total people counts.
  //   admin / eventmanager: all events
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

  // Managers an event manager can choose from, with their team sizes.
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
    const event = await this.eventRepo.save(this.eventRepo.create(data));
    for (const mid of managerIds) {
      await this.addManager(event.event_id, mid);
    }
    // Notify everyone who just became a member (managers + their staff).
    const members = await this.getMemberIds(event.event_id);
    await this.notifications.notifyUsers(
      members,
      'event',
      `You were added to the event "${event.event_name}". / Bạn đã được thêm vào sự kiện "${event.event_name}".`,
    );
    return this.findOne(event.event_id);
  }

  // notify=true is used by the membership editor (a manager added after the
  // event exists); create() inserts in bulk and notifies the whole set itself.
  async addManager(eventId: string, managerId: string, notify = false) {
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
    return this.getEventManagers(eventId);
  }

  async update(id: string, data: Partial<Event>) {
    await this.findOne(id);
    this.assertValidDateRange(data.start_time, data.end_time);
    await this.eventRepo.update(id, data);
    return this.findOne(id);
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
    for (const { task_id } of taskRows) {
      await m.query('DELETE FROM ai_task_map WHERE task_id = $1', [task_id]);
      await m.query(
        'DELETE FROM task_dependencies WHERE task_id = $1 OR depends_on_task = $1',
        [task_id],
      );
      await m.query('DELETE FROM milestones WHERE task_id = $1', [task_id]);
      await m.query('DELETE FROM task_logs WHERE task_id = $1', [task_id]);
      await m.query('DELETE FROM task_assignments WHERE task_id = $1', [
        task_id,
      ]);
      await m.query('DELETE FROM notifications WHERE task_id = $1', [task_id]);
    }
    await m.query('DELETE FROM tasks WHERE event_id = $1', [id]);
    await this.eventRepo.delete(id);
    await this.notifications.notifyUsers(
      members,
      'event',
      `The event "${event.event_name}" was deleted. / Sự kiện "${event.event_name}" đã bị xóa.`,
    );
    return { message: 'Event deleted' };
  }
}
