import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Event } from '../entities/event.entity';

interface Viewer {
  sub: string;
  role: string;
}

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(Event)
    private readonly eventRepo: Repository<Event>,
  ) {}

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
                AND u.manager_id IN (SELECT manager_id FROM event_managers em2 WHERE em2.event_id = e.event_id)) AS people_count
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
    return this.findOne(event.event_id);
  }

  async addManager(eventId: string, managerId: string) {
    await this.eventRepo.manager.query(
      `INSERT INTO event_managers (event_id, manager_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [eventId, managerId],
    );
    return this.getEventManagers(eventId);
  }

  async removeManager(eventId: string, managerId: string) {
    await this.eventRepo.manager.query(
      `DELETE FROM event_managers WHERE event_id = $1 AND manager_id = $2`,
      [eventId, managerId],
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
    await this.findOne(id);
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
    }
    await m.query('DELETE FROM tasks WHERE event_id = $1', [id]);
    await this.eventRepo.delete(id);
    return { message: 'Event deleted' };
  }
}
