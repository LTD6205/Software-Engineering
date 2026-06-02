import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, Between, Not, In } from 'typeorm';
import { Task } from '../entities/task.entity';
import { Notification } from '../entities/notification.entity';
import { TaskAssignment } from '../entities/task-assignment.entity';
import { EventsGateway } from '../websocket/events.gateway';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(Notification) private notifRepo: Repository<Notification>,
    @InjectRepository(TaskAssignment)
    private assignRepo: Repository<TaskAssignment>,
    private readonly gateway: EventsGateway,
  ) {}

  // Runs every 30 minutes automatically
  @Cron(CronExpression.EVERY_30_MINUTES)
  async checkDeadlines() {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Tasks due within next 24 hours — send reminder
    const upcoming = await this.taskRepo.find({
      where: { deadline: Between(now, in24h), status: Not('completed') },
    });
    for (const task of upcoming) {
      await this.sendNotification(
        task,
        'reminder',
        `Reminder: "${task.task_name}" is due within 24 hours. / Nhắc nhở: "${task.task_name}" sắp đến hạn trong 24 giờ.`,
      );
    }

    // Tasks already past deadline — mark overdue + alert.
    // Exclude tasks already flagged 'overdue' so the alert is only sent once
    // (otherwise this cron would re-notify every 30 minutes forever).
    const overdue = await this.taskRepo.find({
      where: {
        deadline: LessThan(now),
        status: Not(In(['completed', 'overdue'])),
      },
    });
    for (const task of overdue) {
      await this.taskRepo.update(task.task_id, { status: 'overdue' });
      await this.sendNotification(
        task,
        'overdue',
        `OVERDUE: "${task.task_name}" has passed its deadline. / QUÁ HẠN: "${task.task_name}" đã quá hạn chót.`,
      );
    }
  }

  // Everyone who should hear about a task's deadline: the assigned staff, each
  // of their owning managers, and the event manager who owns the event.
  private async deadlineRecipients(taskId: string): Promise<string[]> {
    const rows: Array<{ uid: string }> = await this.notifRepo.manager.query(
      `SELECT DISTINCT uid FROM (
         SELECT ta.user_id AS uid FROM task_assignments ta WHERE ta.task_id = $1
         UNION
         SELECT u.manager_id AS uid FROM task_assignments ta
           JOIN users u ON u.user_id = ta.user_id
           WHERE ta.task_id = $1 AND u.manager_id IS NOT NULL
         UNION
         SELECT e.created_by AS uid FROM tasks t
           JOIN events e ON e.event_id = t.event_id
           WHERE t.task_id = $1 AND e.created_by IS NOT NULL
       ) x WHERE uid IS NOT NULL`,
      [taskId],
    );
    return rows.map((r) => r.uid);
  }

  private async sendNotification(task: Task, type: string, message: string) {
    const recipients = await this.deadlineRecipients(task.task_id);
    for (const userId of recipients) {
      // Skip if this user already has an unread notification of the same type
      // for this task — prevents the cron from spamming duplicate reminders.
      const existing = await this.notifRepo.findOne({
        where: {
          user_id: userId,
          task_id: task.task_id,
          type,
          is_read: false,
        },
      });
      if (existing) continue;

      await this.notifRepo.save({
        user_id: userId,
        task_id: task.task_id,
        type,
        message,
      });
      // Push real-time via WebSocket
      this.gateway.sendToUser(userId, {
        type,
        message,
        task_id: task.task_id,
      });
    }
  }

  // Create one notification and push it live. Shared by the other feature
  // services (events, tasks, users) for membership/assignment/reassignment
  // alerts that aren't tied to a deadline.
  async notifyUser(
    userId: string,
    type: string,
    message: string,
    taskId: string | null = null,
    eventId: string | null = null,
  ) {
    if (!userId) return;
    const saved = await this.notifRepo.save({
      user_id: userId,
      task_id: taskId,
      event_id: eventId,
      type,
      message,
    });
    this.gateway.sendToUser(userId, {
      type,
      message,
      task_id: taskId,
      event_id: eventId,
    });
    return saved;
  }

  // Notify several users at once (de-duplicated; blanks skipped).
  async notifyUsers(
    userIds: string[],
    type: string,
    message: string,
    taskId: string | null = null,
    eventId: string | null = null,
  ) {
    const unique = Array.from(new Set((userIds ?? []).filter(Boolean)));
    for (const id of unique) {
      await this.notifyUser(id, type, message, taskId, eventId);
    }
  }

  // Remove a specific event notification (e.g. the "completed" notice once the
  // event is reverted to in-progress). Matched by event + exact message so
  // membership notices for the same event are left untouched.
  async deleteEventNotificationsByMessage(eventId: string, message: string) {
    await this.notifRepo.delete({ event_id: eventId, message });
  }

  getUnread(userId: string) {
    return this.notifRepo.find({
      where: { user_id: userId, is_read: false },
      order: { created_at: 'DESC' },
    });
  }

  // Full history (read + unread), most recent first, capped so it stays light.
  getAll(userId: string) {
    return this.notifRepo.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
      take: 50,
    });
  }

  async markAllRead(userId: string) {
    await this.notifRepo.update(
      { user_id: userId, is_read: false },
      { is_read: true },
    );
    return { message: 'All notifications marked read' };
  }

  // Only marks the notification read if it belongs to the requesting user.
  markRead(notificationId: string, userId: string) {
    return this.notifRepo.update(
      { notification_id: notificationId, user_id: userId },
      { is_read: true },
    );
  }
}
