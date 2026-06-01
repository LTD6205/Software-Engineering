import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, Not, In } from 'typeorm';
import { Task } from '../entities/task.entity';
import { TaskAssignment } from '../entities/task-assignment.entity';
import { TaskDependency } from '../entities/task-dependency.entity';
import { TaskLog } from '../entities/task-log.entity';
import { Milestone } from '../entities/milestone.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(TaskAssignment)
    private assignRepo: Repository<TaskAssignment>,
    @InjectRepository(TaskDependency)
    private depRepo: Repository<TaskDependency>,
    @InjectRepository(TaskLog) private logRepo: Repository<TaskLog>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Milestone) private milestoneRepo: Repository<Milestone>,
  ) {}

  // ── Tasks ──────────────────────────────────────────────────

  findAllByEvent(eventId: string) {
    return this.taskRepo.find({
      where: { event_id: eventId },
      order: { priority_score: 'DESC', deadline: 'ASC' },
    });
  }

  async findOne(id: string) {
    const task = await this.taskRepo.findOne({ where: { task_id: id } });
    if (!task) throw new NotFoundException(`Task ${id} not found`);
    return task;
  }

  create(data: Partial<Task>) {
    if (!data.task_name) {
      throw new BadRequestException(
        'Task name is required / Vui lòng nhập tên công việc',
      );
    }
    if (!data.event_id) {
      throw new BadRequestException(
        'An event is required / Vui lòng chọn sự kiện',
      );
    }
    if (
      data.start_time &&
      data.deadline &&
      new Date(data.deadline) <= new Date(data.start_time)
    ) {
      throw new BadRequestException(
        'Deadline must be after the start time / Hạn chót phải sau thời gian bắt đầu',
      );
    }
    const task = this.taskRepo.create(data);
    return this.taskRepo.save(task);
  }

  async update(id: string, data: Partial<Task>, actorUserId?: string) {
    const old = await this.findOne(id);
    await this.taskRepo.update(id, data);
    // Only write an audit log when we know who made the change. The DB CHECK
    // constraint requires actor_user_id to be set when actor_type = 'user',
    // so logging without an actor would throw and abort the update.
    if (actorUserId) {
      await this.logRepo.save({
        task_id: id,
        action_type: 'task_update',
        old_value: old,
        new_value: data,
        actor_type: 'user',
        actor_user_id: actorUserId,
      });
    }
    return this.findOne(id);
  }

  findOverdue() {
    return this.taskRepo.find({
      where: {
        deadline: LessThan(new Date()),
        status: Not(In(['completed', 'overdue'])),
      },
    });
  }

  // ── Assignments ────────────────────────────────────────────

  getAssignments(taskId: string) {
    return this.assignRepo.find({ where: { task_id: taskId } });
  }

  async assignUser(taskId: string, userId: string) {
    const u = await this.userRepo.findOne({ where: { user_id: userId } });
    if (!u) {
      throw new NotFoundException('User not found / Không tìm thấy người dùng');
    }
    // Tasks may only be assigned to staff and managers, never admins.
    if (u.role === 'admin') {
      throw new BadRequestException(
        'Tasks cannot be assigned to an admin / Không thể giao công việc cho quản trị viên',
      );
    }
    const assignment = this.assignRepo.create({
      task_id: taskId,
      user_id: userId,
    });
    return this.assignRepo.save(assignment);
  }

  unassignUser(taskId: string, userId: string) {
    return this.assignRepo.delete({ task_id: taskId, user_id: userId });
  }

  // ── Milestones ─────────────────────────────────────────────

  getMilestones(taskId: string) {
    return this.milestoneRepo.find({
      where: { task_id: taskId },
      order: { percentage: 'ASC' },
    });
  }

  addMilestone(taskId: string, data: Partial<Milestone>) {
    const milestone = this.milestoneRepo.create({ ...data, task_id: taskId });
    return this.milestoneRepo.save(milestone);
  }

  completeMilestone(milestoneId: string) {
    return this.milestoneRepo.update(milestoneId, { is_completed: true });
  }
}
