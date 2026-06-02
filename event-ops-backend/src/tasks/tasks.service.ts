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
import { TaskGroup } from '../entities/task-group.entity';
import { TaskLog } from '../entities/task-log.entity';
import { User } from '../entities/user.entity';
import { Event } from '../entities/event.entity';
import { EventsGateway } from '../websocket/events.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(TaskAssignment)
    private assignRepo: Repository<TaskAssignment>,
    @InjectRepository(TaskDependency)
    private depRepo: Repository<TaskDependency>,
    @InjectRepository(TaskGroup) private groupRepo: Repository<TaskGroup>,
    @InjectRepository(TaskLog) private logRepo: Repository<TaskLog>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Event) private eventRepo: Repository<Event>,
    private readonly gateway: EventsGateway,
    private readonly notifications: NotificationsService,
    private readonly events: EventsService,
  ) {}

  // Tell connected clients something changed so they can refetch live.
  private broadcastChange(eventId?: string) {
    this.gateway.broadcast('data_changed', { kind: 'task', event_id: eventId });
  }

  // ── Tasks ──────────────────────────────────────────────────

  async findAllByEvent(
    eventId: string,
    viewer?: { sub: string; role: string },
  ) {
    let tasks = await this.taskRepo.find({
      where: { event_id: eventId },
      order: { priority_score: 'DESC', deadline: 'ASC' },
    });
    // Staff only see tasks they are assigned to; managers+ see all of them.
    if (viewer?.role === 'staff') {
      const mine = await this.assignRepo.find({
        where: { user_id: viewer.sub },
      });
      const myTaskIds = new Set(mine.map((a) => a.task_id));
      tasks = tasks.filter((tk) => myTaskIds.has(tk.task_id));
    }
    if (tasks.length === 0) return tasks;
    // Attach each task's assignees (id, name, avatar) so the UI can show
    // avatars without a request per task.
    const ids = tasks.map((tk) => tk.task_id);
    const rows: Array<{
      task_id: string;
      user_id: string;
      name: string;
      avatar: string | null;
    }> = await this.assignRepo.manager.query(
      `SELECT ta.task_id, u.user_id, u.name, u.avatar
       FROM task_assignments ta JOIN users u ON u.user_id = ta.user_id
       WHERE ta.task_id = ANY($1::uuid[])
       ORDER BY u.name ASC`,
      [ids],
    );
    const byTask = new Map<string, Array<Record<string, unknown>>>();
    for (const r of rows) {
      const list = byTask.get(r.task_id) ?? [];
      list.push({ user_id: r.user_id, name: r.name, avatar: r.avatar });
      byTask.set(r.task_id, list);
    }
    // Attach each task's group title (if merged) so the timeline can label groups.
    const groupIds = Array.from(
      new Set(tasks.map((t) => t.group_id).filter(Boolean)),
    ) as string[];
    const groupTitle = new Map<string, string>();
    if (groupIds.length > 0) {
      const groups = await this.groupRepo.find({
        where: { group_id: In(groupIds) },
      });
      for (const g of groups) groupTitle.set(g.group_id, g.title);
    }
    return tasks.map((tk) => ({
      ...tk,
      assignees: byTask.get(tk.task_id) ?? [],
      group_title: tk.group_id ? (groupTitle.get(tk.group_id) ?? '') : null,
    }));
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
    // Managers don't set priority — it's auto-derived from the timeline unless
    // the caller (e.g. AI) explicitly provided a source.
    if (!data.priority_source) data.priority_source = 'auto';
    // No "pending" stage: a new task starts In Progress.
    if (!data.status) data.status = 'in_progress';
    const task = await this.taskRepo.save(this.taskRepo.create(data));
    // Announce the new task to the event's owner (the event manager), unless
    // they created it themselves.
    const event = await this.eventRepo.findOne({
      where: { event_id: task.event_id },
    });
    if (event?.created_by && event.created_by !== task.created_by) {
      await this.notifications.notifyUser(
        event.created_by,
        'task',
        `A new task "${task.task_name}" was added to "${event.event_name}". / Công việc mới "${task.task_name}" đã được thêm vào "${event.event_name}".`,
        task.task_id,
        task.event_id,
      );
    }
    // Adding a task moves its event into "in progress".
    await this.recomputeEventStatus(task.event_id);
    // Re-bucket auto priorities now the task set changed.
    await this.recomputeAutoPriorities(task.event_id);
    this.broadcastChange(task.event_id);
    return this.findOne(task.task_id);
  }

  // Auto priority: bucket each 'auto' task into High/Medium/Low by where its
  // deadline (or start) falls across the event's overall task timeline — the
  // earliest third is High, the middle Medium, the latest Low. Tasks a manager
  // set by hand (source 'user') and AI tasks ('ai') are left untouched.
  private async recomputeAutoPriorities(eventId: string) {
    if (!eventId) return;
    const tasks = await this.taskRepo.find({ where: { event_id: eventId } });
    const basis = (t: Task): number => {
      const d = t.deadline ? new Date(t.deadline).getTime() : NaN;
      const s = t.start_time ? new Date(t.start_time).getTime() : NaN;
      return !isNaN(d) ? d : s;
    };
    const times = tasks.map(basis).filter((v) => !isNaN(v));
    if (times.length === 0) return;
    const min = Math.min(...times);
    const span = Math.max(...times) - min;
    for (const t of tasks) {
      if (t.priority_source !== 'auto') continue;
      const b = basis(t);
      if (isNaN(b)) continue;
      const frac = span <= 0 ? 0 : (b - min) / span;
      const label = frac < 1 / 3 ? 'high' : frac < 2 / 3 ? 'medium' : 'low';
      const score = label === 'high' ? 90 : label === 'medium' ? 50 : 10;
      if (t.priority_label !== label || t.priority_score !== score) {
        await this.taskRepo.update(t.task_id, {
          priority_label: label,
          priority_score: score,
        });
      }
    }
  }

  // An event's status is derived from its tasks:
  //   no tasks -> pending; all tasks completed -> completed; otherwise -> in progress.
  private async recomputeEventStatus(eventId: string) {
    if (!eventId) return;
    const event = await this.eventRepo.findOne({
      where: { event_id: eventId },
    });
    if (!event) return;
    const tasks = await this.taskRepo.find({ where: { event_id: eventId } });
    let status = 'pending';
    if (tasks.length > 0) {
      status = tasks.every((tk) => tk.status === 'completed')
        ? 'completed'
        : 'in_progress';
    }
    const completeMsg = `The event "${event.event_name}" is now complete. / Sự kiện "${event.event_name}" đã hoàn thành.`;
    if (event.status !== status) {
      await this.eventRepo.update(eventId, { status });
      // Celebrate an event that just completed, and notify every member.
      if (status === 'completed') {
        this.gateway.broadcast('celebrate', {
          kind: 'event',
          name: event.event_name,
        });
        const members = await this.events.getMemberIds(eventId);
        await this.notifications.notifyUsers(
          members,
          'event',
          completeMsg,
          null,
          eventId,
        );
      } else if (event.status === 'completed') {
        // Reverted from completed (a task reopened/added/deleted): the
        // "completed" notice is now stale, so clear it for everyone.
        await this.notifications.deleteEventNotificationsByMessage(
          eventId,
          completeMsg,
        );
      }
    }
  }

  async update(
    id: string,
    data: Partial<Task>,
    actor?: { sub: string; role: string },
  ) {
    const old = await this.findOne(id);

    // A manual priority edit pins the task to 'user' so auto-recompute won't
    // overwrite it (and fill in the matching score if not given).
    if (data.priority_label !== undefined) {
      data.priority_source = 'user';
      if (data.priority_score === undefined) {
        data.priority_score =
          data.priority_label === 'high'
            ? 90
            : data.priority_label === 'medium'
              ? 50
              : 10;
      }
    }

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
    // Celebrate a task that was just completed.
    if (data.status === 'completed' && old.status !== 'completed') {
      this.gateway.broadcast('celebrate', {
        kind: 'task',
        name: old.task_name,
      });
    }
    // A task's status change may move its event between pending/in_progress/completed.
    if (data.status !== undefined) {
      await this.recomputeEventStatus(old.event_id);
    }
    // Adjusting a task's timing re-buckets the event's auto priorities.
    if (data.start_time !== undefined || data.deadline !== undefined) {
      await this.recomputeAutoPriorities(old.event_id);
    }
    this.broadcastChange(old.event_id);
    return this.findOne(id);
  }

  async remove(id: string) {
    const task = await this.findOne(id);
    // Child rows are removed automatically by ON DELETE CASCADE once the FK
    // migration (npm run db:migrate) has been applied. We still clear them here
    // as a fallback so deletion also works on databases created before that
    // migration; on an up-to-date schema these deletes simply find nothing.
    const m = this.taskRepo.manager;
    await m.query('DELETE FROM ai_task_map WHERE task_id = $1', [id]);
    await m.query(
      'DELETE FROM task_dependencies WHERE task_id = $1 OR depends_on_task = $1',
      [id],
    );
    await m.query('DELETE FROM task_logs WHERE task_id = $1', [id]);
    await m.query('DELETE FROM task_assignments WHERE task_id = $1', [id]);
    await m.query('DELETE FROM notifications WHERE task_id = $1', [id]);
    await this.taskRepo.delete(id);
    // If it was in a group, dissolve the group if it now has < 2 members.
    if (task.group_id) {
      await this.dissolveIfTooSmall(task.group_id);
    }
    await this.recomputeEventStatus(task.event_id);
    // The timeline shrank — re-bucket auto priorities.
    await this.recomputeAutoPriorities(task.event_id);
    this.broadcastChange(task.event_id);
    return { message: 'Task deleted' };
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

  // Assignees with their display details (for avatars / the re-select picker).
  getAssigneesDetailed(taskId: string): Promise<unknown[]> {
    return this.assignRepo.manager.query(
      `SELECT u.user_id, u.name, u.avatar
       FROM task_assignments ta JOIN users u ON u.user_id = ta.user_id
       WHERE ta.task_id = $1
       ORDER BY u.name ASC`,
      [taskId],
    );
  }

  // A task may only be assigned to staff members. A manager may only assign
  // their own staff; admins/eventmanagers may assign any staff member.
  private async assertAssignable(
    userId: string,
    actor?: { sub: string; role: string },
  ) {
    const u = await this.userRepo.findOne({ where: { user_id: userId } });
    if (!u) {
      throw new NotFoundException('User not found / Không tìm thấy người dùng');
    }
    if (u.role !== 'staff') {
      throw new BadRequestException(
        'Tasks can only be assigned to staff members / Chỉ có thể giao công việc cho nhân viên',
      );
    }
    if (actor && actor.role === 'manager' && u.manager_id !== actor.sub) {
      throw new BadRequestException(
        'You can only assign your own staff / Bạn chỉ có thể giao cho nhân viên của mình',
      );
    }
  }

  async assignUser(
    taskId: string,
    userId: string,
    actor?: { sub: string; role: string },
  ) {
    await this.assertAssignable(userId, actor);
    const assignment = this.assignRepo.create({
      task_id: taskId,
      user_id: userId,
    });
    const saved = await this.assignRepo.save(assignment);
    const task = await this.findOne(taskId);
    await this.notifications.notifyUser(
      userId,
      'task',
      `You were assigned to the task "${task.task_name}". / Bạn được giao công việc "${task.task_name}".`,
      taskId,
    );
    return saved;
  }

  unassignUser(taskId: string, userId: string) {
    return this.assignRepo.delete({ task_id: taskId, user_id: userId });
  }

  // Replace a task's entire assignee set in one call (used by create and the
  // avatar re-select picker). Validates every target before changing anything.
  async setAssignees(
    taskId: string,
    userIds: string[],
    actor?: { sub: string; role: string },
  ) {
    const task = await this.findOne(taskId);
    const ids = Array.from(new Set(userIds ?? []));
    for (const uid of ids) await this.assertAssignable(uid, actor);
    // Diff against the current set so only genuine changes get notified.
    const before = (
      await this.assignRepo.find({ where: { task_id: taskId } })
    ).map((a) => a.user_id);
    await this.assignRepo.delete({ task_id: taskId });
    for (const uid of ids) {
      await this.assignRepo.save(
        this.assignRepo.create({ task_id: taskId, user_id: uid }),
      );
    }
    const added = ids.filter((i) => !before.includes(i));
    const removed = before.filter((i) => !ids.includes(i));
    await this.notifications.notifyUsers(
      added,
      'task',
      `You were assigned to the task "${task.task_name}". / Bạn được giao công việc "${task.task_name}".`,
      taskId,
    );
    await this.notifications.notifyUsers(
      removed,
      'task',
      `You were removed from the task "${task.task_name}". / Bạn đã bị gỡ khỏi công việc "${task.task_name}".`,
      taskId,
    );
    this.broadcastChange(task.event_id);
    return this.getAssigneesDetailed(taskId);
  }

  // ── Task groups (merged tasks) ─────────────────────────────
  // Grouping only *links* tasks (sets group_id). Each member keeps its own
  // start/deadline, so the timeline lays them out at their real times and
  // ungrouping needs no time restore.

  // Below 2 members a group is pointless — dissolve it (members get ungrouped
  // automatically via ON DELETE SET NULL).
  private async dissolveIfTooSmall(groupId: string) {
    const count = await this.taskRepo.count({ where: { group_id: groupId } });
    if (count < 2) await this.groupRepo.delete(groupId);
  }

  // Drop the "source" task onto the "target": both end up in one group (the
  // target's existing group, or a brand-new one). Times are left untouched.
  async merge(sourceId: string, targetId: string) {
    if (sourceId === targetId) {
      throw new BadRequestException(
        'Cannot merge a task with itself / Không thể gộp một công việc với chính nó',
      );
    }
    const source = await this.findOne(sourceId);
    const target = await this.findOne(targetId);
    if (source.event_id !== target.event_id) {
      throw new BadRequestException(
        'Tasks must be in the same event / Công việc phải thuộc cùng một sự kiện',
      );
    }
    let groupId = target.group_id;
    if (!groupId) {
      const group = await this.groupRepo.save(
        this.groupRepo.create({ event_id: target.event_id, title: '' }),
      );
      groupId = group.group_id;
      await this.taskRepo.update(target.task_id, { group_id: groupId });
    }
    const oldGroup = source.group_id;
    await this.taskRepo.update(source.task_id, { group_id: groupId });
    if (oldGroup && oldGroup !== groupId) {
      await this.dissolveIfTooSmall(oldGroup);
    }
    this.broadcastChange(target.event_id);
    return { group_id: groupId };
  }

  // Add an existing task to an existing group (drop onto a group band).
  async addToGroup(groupId: string, taskId: string) {
    const group = await this.groupRepo.findOne({
      where: { group_id: groupId },
    });
    if (!group)
      throw new NotFoundException('Group not found / Không tìm thấy nhóm');
    const task = await this.findOne(taskId);
    if (task.event_id !== group.event_id) {
      throw new BadRequestException(
        'Task must be in the same event / Công việc phải thuộc cùng một sự kiện',
      );
    }
    const oldGroup = task.group_id;
    if (oldGroup === groupId) return { group_id: groupId };
    await this.taskRepo.update(taskId, { group_id: groupId });
    if (oldGroup) {
      await this.dissolveIfTooSmall(oldGroup);
    }
    this.broadcastChange(group.event_id);
    return { group_id: groupId };
  }

  // Remove a task from its group; dissolve the group if it drops below 2.
  async ungroup(taskId: string) {
    const task = await this.findOne(taskId);
    const groupId = task.group_id;
    if (!groupId) return { ok: true };
    await this.taskRepo.update(taskId, { group_id: null });
    await this.dissolveIfTooSmall(groupId);
    this.broadcastChange(task.event_id);
    return { ok: true };
  }

  async renameGroup(groupId: string, title: string) {
    const group = await this.groupRepo.findOne({
      where: { group_id: groupId },
    });
    if (!group)
      throw new NotFoundException('Group not found / Không tìm thấy nhóm');
    await this.groupRepo.update(groupId, { title: (title ?? '').slice(0, 255) });
    this.broadcastChange(group.event_id);
    return this.groupRepo.findOne({ where: { group_id: groupId } });
  }
}
