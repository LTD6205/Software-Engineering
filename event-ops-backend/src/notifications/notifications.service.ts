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

  private async sendNotification(task: Task, type: string, message: string) {
    const assignments = await this.assignRepo.find({
      where: { task_id: task.task_id },
    });
    for (const assignment of assignments) {
      // Skip if this user already has an unread notification of the same type
      // for this task — prevents the cron from spamming duplicate reminders.
      const existing = await this.notifRepo.findOne({
        where: {
          user_id: assignment.user_id,
          task_id: task.task_id,
          type,
          is_read: false,
        },
      });
      if (existing) continue;

      await this.notifRepo.save({
        user_id: assignment.user_id,
        task_id: task.task_id,
        type,
        message,
      });
      // Push real-time via WebSocket
      this.gateway.sendToUser(assignment.user_id, {
        type,
        message,
        task_id: task.task_id,
      });
    }
  }

  getUnread(userId: string) {
    return this.notifRepo.find({
      where: { user_id: userId, is_read: false },
      order: { created_at: 'DESC' },
    });
  }

  markRead(notificationId: string) {
    return this.notifRepo.update(notificationId, { is_read: true });
  }
}
