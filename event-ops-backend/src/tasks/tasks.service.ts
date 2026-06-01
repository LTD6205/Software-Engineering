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
import { Event } from '../entities/event.entity';

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
    @InjectRepository(Event) private eventRepo: Repository<Event>,
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

  async create(data: Partial<Task>) {
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
    const task = await this.taskRepo.save(this.taskRepo.create(data));
    // Adding a task moves its event into "in progress".
    await this.recomputeEventStatus(task.event_id);
    return task;
  }

  // An event's status is derived from its tasks:
  //   no tasks -> pending; all tasks completed -> completed; otherwise -> in progress.
  private async recomputeEventStatus(eventId: string) {
    if (!eventId) return;
    const tasks = await this.taskRepo.find({ where: { event_id: eventId } });
    let status = 'pending';
    if (tasks.length > 0) {
      status = tasks.every((tk) => tk.status === 'completed')
        ? 'completed'
        : 'in_progress';
    }
    await this.eventRepo.update(eventId, { status });
  }

  async update(
    id: string,
    data: Partial<Task>,
    actor?: { sub: string; role: string },
  ) {
    const old = await this.findOne(id);

    // Enforce who may change a task's status, and which transitions are allowed.
    if (data.status !== undefined && data.status !== old.status && actor) {
      await this.assertStatusChangeAllowed(old, data.status, actor);
    }

    await this.taskRepo.update(id, data);
    // The DB CHECK requires actor_user_id when actor_type = 'user', so only log
    // when we know who made the change.
    if (actor?.sub) {
      await this.logRepo.save({
        task_id: id,
        action_type: 'task_update',
        old_value: old,
        new_value: data,
        actor_type: 'user',
        actor_user_id: actor.sub,
      });
    }
    // A task's status change may move its event between pending/in_progress/completed.
    if (data.status !== undefined) {
      await this.recomputeEventStatus(old.event_id);
    }
    return this.findOne(id);
  }

  private async assertStatusChangeAllowed(
    task: Task,
    next: string,
    actor: { sub: string; role: string },
  ) {
    const assignments = await this.assignRepo.find({
      where: { task_id: task.task_id },
    });
    const isCreator = task.created_by === actor.sub;
    const isAssigned = assignments.some((a) => a.user_id === actor.sub);

    // Only the creator or an assigned member may change the status.
    if (!isCreator && !isAssigned) {
      throw new BadRequestException(
        'You are not allowed to change this task / Bạn không có quyền thay đổi công việc này',
      );
    }

    // Reopening a completed task (completed -> anything else) is creator-only.
    if (task.status === 'completed' && next !== 'completed' && !isCreator) {
      throw new BadRequestException(
        'Only the creator can reopen a completed task / Chỉ người tạo mới có thể mở lại công việc đã hoàn thành',
      );
    }

    // Assigned staff (not the creator) may only move forward to in_progress or
    // completed — never backwards.
    if (isAssigned && !isCreator) {
      const order: Record<string, number> = {
        pending: 0,
        in_progress: 1,
        completed: 2,
      };
      const allowed = next === 'in_progress' || next === 'completed';
      const notBackwards = (order[next] ?? -1) >= (order[task.status] ?? 0);
      if (!allowed || !notBackwards) {
        throw new BadRequestException(
          'Assigned staff can only move a task forward to In Progress or Completed / Nhân viên được giao chỉ có thể chuyển công việc tiến tới Đang làm hoặc Hoàn thành',
        );
      }
    }
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
