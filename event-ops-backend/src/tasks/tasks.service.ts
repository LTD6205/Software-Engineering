import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
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
    // forwardRef: EventsService also depends on TasksService (it recomputes task
    // priorities after an event's dates change), so the two form a cycle.
    @Inject(forwardRef(() => EventsService))
    private readonly events: EventsService,
  ) {}

  // Tell the event's members something changed so they can refetch live.
  private broadcastChange(eventId?: string) {
    this.gateway.broadcastToEvent(eventId, 'data_changed', {
      kind: 'task',
      event_id: eventId,
    });
  }

  // ── Tasks ──────────────────────────────────────────────────

  async findAllByEvent(
    eventId: string,
    viewer?: { sub: string; role: string },
  ) {
    // Tasks are only readable to people on the event: a manager must belong to
    // it, a staff member's manager must, and admins/organizers see all.
    if (viewer) await this.events.assertCanViewEvent(viewer, eventId);
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

  // Viewer-scoped single-task read (GET /tasks/:id): the task is only returned
  // if the viewer can see its event, so a raw task UUID can't be read by someone
  // outside the event.
  async findOneForViewer(id: string, viewer: { sub: string; role: string }) {
    const task = await this.findOne(id);
    await this.events.assertCanViewEvent(viewer, task.event_id);
    return task;
  }

  // Viewer-scoped assignment read (GET /tasks/:id/assignments): same event-
  // visibility gate as the task itself.
  async getAssignmentsForViewer(
    id: string,
    viewer: { sub: string; role: string },
  ) {
    const task = await this.findOne(id);
    await this.events.assertCanViewEvent(viewer, task.event_id);
    return this.getAssignments(id);
  }

  async create(data: Partial<Task>, actor?: { sub: string; role: string }) {
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
    // The caller may only add tasks to an event they manage.
    if (actor) await this.events.assertCanManageEvent(actor, data.event_id);
    // The creator is always the authenticated actor — never a client-supplied
    // value — so a task can't be attributed to someone else.
    if (actor) data.created_by = actor.sub;
    // Managers don't set priority — it's auto-derived from the timeline unless
    // the caller (e.g. AI) explicitly provided a source.
    if (!data.priority_source) data.priority_source = 'auto';
    // No "pending" stage: a new task starts In Progress.
    if (!data.status) data.status = 'in_progress';
    // A task's start/deadline must fall inside its event's window.
    const event = await this.eventRepo.findOne({
      where: { event_id: data.event_id },
    });
    if (event)
      this.assertWithinEventWindow(event, data.start_time, data.deadline);
    // A new task can't be scheduled in the past.
    this.assertNotInPast(data.start_time, data.deadline);
    const task = await this.taskRepo.save(this.taskRepo.create(data));
    // Announce the new task to the event's owner (the organizer), unless
    // they created it themselves.
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

  // Grace window for the past check: the client's "now" line can lag a little
  // (it ticks every ~30s) and there's request latency, so a time the user meant
  // as "now" can read as a few seconds past by the time the server checks. Allow
  // a small slack so only clearly-past times (minutes+ old) are rejected.
  private static readonly PAST_GRACE_MS = 2 * 60 * 1000;

  // New or edited task times may not land in the past — the API mirror of the
  // timeline's "now" line. Only the values passed in are checked, so editing an
  // unrelated field on an already-running (or overdue) task, or reopening it via
  // a status change, is unaffected; only a start/deadline being set into the
  // past is rejected.
  private assertNotInPast(...values: Array<Date | string | null | undefined>) {
    const cutoff = Date.now() - TasksService.PAST_GRACE_MS;
    for (const v of values) {
      if (!v) continue;
      const t = new Date(v).getTime();
      if (isNaN(t)) continue;
      if (t < cutoff) {
        throw new BadRequestException(
          'Task times cannot be in the past / Thời gian công việc không thể ở quá khứ',
        );
      }
    }
  }

  // A task's start/deadline must sit inside its event's [start, end] window.
  private assertWithinEventWindow(
    event: Event,
    start?: Date | string | null,
    deadline?: Date | string | null,
  ) {
    const es = event.start_time ? new Date(event.start_time).getTime() : null;
    const ee = event.end_time ? new Date(event.end_time).getTime() : null;
    for (const v of [start, deadline]) {
      if (!v) continue;
      const t = new Date(v).getTime();
      if (isNaN(t)) continue;
      if ((es !== null && t < es) || (ee !== null && t > ee)) {
        throw new BadRequestException(
          'Task times must be within the event window / Thời gian công việc phải nằm trong khoảng thời gian của sự kiện',
        );
      }
    }
  }

  // Fields a client may set through create/update. Anything else (event_id,
  // created_by, task_id, group_id, created_at) is server-controlled and dropped
  // so a task can't be moved between events or re-attributed via the body.
  private static readonly UPDATABLE_FIELDS: ReadonlyArray<keyof Task> = [
    'task_name',
    'description',
    'priority_label',
    'priority_score',
    'priority_source',
    'status',
    'start_time',
    'deadline',
  ];

  private pickUpdatable(data: Partial<Task>): Partial<Task> {
    const out: Partial<Task> = {};
    for (const key of TasksService.UPDATABLE_FIELDS) {
      if (data[key] !== undefined) {
        (out[key] as unknown) = data[key];
      }
    }
    return out;
  }

  // Auto priority: bucket each 'auto' task into High/Medium/Low by where its
  // deadline (or start) falls across a timeline — the earliest third is High,
  // the middle Medium, the latest Low. Tasks a manager set by hand
  // (source 'user') and AI tasks ('ai') are left untouched.
  //
  // The timeline starts at the live "now" line:
  //   • any task whose time is already in the past (overdue) is always High;
  //   • ungrouped tasks rank from now → the latest task deadline;
  //   • a group's members rank WITHIN their own group's span, so reordering two
  //     members by time (e.g. dragging b ahead of a) flips their relative
  //     priority — a narrow group no longer collapses to one shared bucket.
  // Public so EventsService can re-bucket after an event's dates change (#7).
  async recomputeAutoPriorities(eventId: string) {
    if (!eventId) return;
    const tasks = await this.taskRepo.find({ where: { event_id: eventId } });
    const now = Date.now();
    const basis = (t: Task): number => {
      const d = t.deadline ? new Date(t.deadline).getTime() : NaN;
      const s = t.start_time ? new Date(t.start_time).getTime() : NaN;
      return !isNaN(d) ? d : s;
    };
    // The [min, span] of a set of tasks' basis times (undated tasks ignored).
    const windowOf = (cohort: Task[]): [number, number] | null => {
      const times = cohort.map(basis).filter((v) => !isNaN(v));
      if (times.length === 0) return null;
      const min = Math.min(...times);
      return [min, Math.max(...times) - min];
    };
    // Re-bucket a single 'auto' task against a [min, span] window. Anything past
    // the "now" line is always High regardless of the window.
    const bucket = async (t: Task, min: number, span: number) => {
      if (t.priority_source !== 'auto') return;
      const b = basis(t);
      if (isNaN(b)) return;
      let label: string;
      if (b < now) {
        label = 'high';
      } else {
        const frac = span <= 0 ? 0 : (b - min) / span;
        label = frac < 1 / 3 ? 'high' : frac < 2 / 3 ? 'medium' : 'low';
      }
      const score = label === 'high' ? 90 : label === 'medium' ? 50 : 10;
      if (t.priority_label !== label || t.priority_score !== score) {
        await this.taskRepo.update(t.task_id, {
          priority_label: label,
          priority_score: score,
        });
      }
    };
    // Ungrouped tasks rank from "now" to the latest task deadline; each group's
    // members rank within their own span.
    const ungrouped: Task[] = [];
    const byGroup = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.group_id) {
        const members = byGroup.get(t.group_id) ?? [];
        members.push(t);
        byGroup.set(t.group_id, members);
      } else {
        ungrouped.push(t);
      }
    }
    const eventWindow = windowOf(tasks);
    if (eventWindow) {
      // Start the ungrouped timeline at "now" (clamped so a fully-past event
      // still yields a valid, non-negative span).
      const latest = eventWindow[0] + eventWindow[1];
      const min = Math.min(now, latest);
      for (const t of ungrouped) await bucket(t, min, latest - min);
    }
    for (const members of byGroup.values()) {
      const w = windowOf(members);
      if (!w) continue;
      for (const t of members) await bucket(t, w[0], w[1]);
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
        this.gateway.broadcastToEvent(eventId, 'celebrate', {
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

    // Drop any server-controlled fields the client tried to set (event_id,
    // created_by, etc.) so an update can't move a task between events or
    // re-attribute it.
    data = this.pickUpdatable(data);

    // Editing anything other than `status` is a manager action and requires
    // managing the task's event. The status field has its own per-actor rules
    // below (creator/assignee), so a plain assignee can still progress a task.
    const editsMetadata = Object.keys(data).some((k) => k !== 'status');
    if (editsMetadata) {
      if (!actor || actor.role === 'staff') {
        throw new BadRequestException(
          'You are not allowed to edit this task / Bạn không có quyền chỉnh sửa công việc này',
        );
      }
      await this.events.assertCanManageEvent(actor, old.event_id);
    }

    // Reopening a task whose deadline has already passed (e.g. an overdue task
    // moved back to In Progress): slide it forward to start at "now", keeping
    // its length and staying inside the event window, so it's no longer stuck in
    // the past. The auto-priority recompute below then re-buckets it from now.
    // Done after the metadata-permission gate so an assignee reopening their own
    // task isn't blocked, and skipped if the caller set explicit times.
    if (
      data.status === 'in_progress' &&
      data.status !== old.status &&
      data.start_time === undefined &&
      data.deadline === undefined
    ) {
      const nowTs = Date.now();
      const oldDeadline = old.deadline
        ? new Date(old.deadline).getTime()
        : null;
      if (oldDeadline !== null && oldDeadline < nowTs) {
        const oldStart = old.start_time
          ? new Date(old.start_time).getTime()
          : null;
        const duration =
          oldStart !== null && oldDeadline > oldStart
            ? oldDeadline - oldStart
            : 60 * 60 * 1000; // default 1h window when the task had no start
        const ev = await this.eventRepo.findOne({
          where: { event_id: old.event_id },
        });
        const eventEnd = ev?.end_time ? new Date(ev.end_time).getTime() : null;
        // Only move while there's still room before the event ends.
        if (eventEnd === null || nowTs < eventEnd) {
          let newDeadline = nowTs + duration;
          if (eventEnd !== null && newDeadline > eventEnd)
            newDeadline = eventEnd;
          data.start_time = new Date(nowTs);
          data.deadline = new Date(newDeadline);
        }
      }
    }

    // A reschedule must keep the task inside its event's window.
    if (data.start_time !== undefined || data.deadline !== undefined) {
      const event = await this.eventRepo.findOne({
        where: { event_id: old.event_id },
      });
      if (event) {
        this.assertWithinEventWindow(
          event,
          data.start_time ?? old.start_time,
          data.deadline ?? old.deadline,
        );
      }
      // A start/deadline being set can't be moved into the past. Only the
      // values present in this update are checked (not the merged old ones), so
      // editing one field of an already-running task isn't blocked by the other.
      this.assertNotInPast(data.start_time, data.deadline);

      // The DB enforces deadline > start_time (tasks_time_check). Check the
      // effective (merged) window here so a zero- or negative-length reschedule —
      // e.g. dragging a task that had only a deadline, so start === deadline —
      // returns a clean validation error instead of an unhandled 500 from the
      // constraint.
      const effStart = data.start_time ?? old.start_time;
      const effDeadline = data.deadline ?? old.deadline;
      if (
        effStart &&
        effDeadline &&
        new Date(effDeadline).getTime() <= new Date(effStart).getTime()
      ) {
        throw new BadRequestException(
          'Deadline must be after the start time / Hạn chót phải sau thời gian bắt đầu',
        );
      }
    }

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
      this.gateway.broadcastToEvent(old.event_id, 'celebrate', {
        kind: 'task',
        name: old.task_name,
      });
    }
    // A task's status change may move its event between pending/in_progress/completed.
    if (data.status !== undefined) {
      await this.recomputeEventStatus(old.event_id);
    }
    // Adjusting a task's timing — or reopening it — re-buckets the event's auto
    // priorities (a reopened overdue task was just slid to "now" above, and any
    // status change should leave priorities current).
    if (
      data.start_time !== undefined ||
      data.deadline !== undefined ||
      data.status !== undefined
    ) {
      await this.recomputeAutoPriorities(old.event_id);
    }
    this.broadcastChange(old.event_id);
    return this.findOne(id);
  }

  async remove(id: string, actor?: { sub: string; role: string }) {
    const task = await this.findOne(id);
    if (actor) await this.events.assertCanManageEvent(actor, task.event_id);
    // Child rows are removed automatically by ON DELETE CASCADE once the FK
    // migration (npm run db:migrate) has been applied. We still clear them here
    // as a fallback so deletion also works on databases created before that
    // migration; on an up-to-date schema these deletes simply find nothing.
    // The whole delete sequence runs in one transaction so a failure partway
    // can't leave the task orphaned with some child rows already gone.
    await this.taskRepo.manager.transaction(async (m) => {
      await m.query('DELETE FROM ai_task_map WHERE task_id = $1', [id]);
      await m.query(
        'DELETE FROM task_dependencies WHERE task_id = $1 OR depends_on_task = $1',
        [id],
      );
      await m.query('DELETE FROM task_logs WHERE task_id = $1', [id]);
      await m.query('DELETE FROM task_assignments WHERE task_id = $1', [id]);
      await m.query('DELETE FROM notifications WHERE task_id = $1', [id]);
      await m.delete(Task, id);
    });
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
  // their own staff; admins/organizers may assign any staff member.
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
    const task = await this.findOne(taskId);
    // The actor must manage the task's event before touching its assignments.
    if (actor) await this.events.assertCanManageEvent(actor, task.event_id);
    await this.assertAssignable(userId, actor);
    const assignment = this.assignRepo.create({
      task_id: taskId,
      user_id: userId,
    });
    const saved = await this.assignRepo.save(assignment);
    await this.notifications.notifyUser(
      userId,
      'task',
      `You were assigned to the task "${task.task_name}". / Bạn được giao công việc "${task.task_name}".`,
      taskId,
    );
    return saved;
  }

  // Replace a task's entire assignee set in one call (used by create and the
  // avatar re-select picker). Validates every target before changing anything.
  async setAssignees(
    taskId: string,
    userIds: string[],
    actor?: { sub: string; role: string },
  ) {
    const task = await this.findOne(taskId);
    if (actor) await this.events.assertCanManageEvent(actor, task.event_id);
    const ids = Array.from(new Set(userIds ?? []));
    for (const uid of ids) await this.assertAssignable(uid, actor);
    // Diff against the current set so only genuine changes get notified.
    const before = (
      await this.assignRepo.find({ where: { task_id: taskId } })
    ).map((a) => a.user_id);
    // Replace the whole set atomically so a failure can't leave the task with no
    // assignees (the delete + inserts commit together, or not at all).
    await this.assignRepo.manager.transaction(async (em) => {
      await em.delete(TaskAssignment, { task_id: taskId });
      for (const uid of ids) {
        await em.save(
          em.create(TaskAssignment, { task_id: taskId, user_id: uid }),
        );
      }
    });
    // Notifications/broadcast run only after the replacement has committed.
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
  async merge(
    sourceId: string,
    targetId: string,
    actor?: { sub: string; role: string },
  ) {
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
    if (actor) await this.events.assertCanManageEvent(actor, target.event_id);
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
    // Membership changed which timeline each task ranks against, so re-bucket
    // the event's auto priorities (the new group ranks within itself).
    await this.recomputeAutoPriorities(target.event_id);
    this.broadcastChange(target.event_id);
    return { group_id: groupId };
  }

  // Add an existing task to an existing group (drop onto a group band).
  async addToGroup(
    groupId: string,
    taskId: string,
    actor?: { sub: string; role: string },
  ) {
    const group = await this.groupRepo.findOne({
      where: { group_id: groupId },
    });
    if (!group)
      throw new NotFoundException('Group not found / Không tìm thấy nhóm');
    if (actor) await this.events.assertCanManageEvent(actor, group.event_id);
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
    // The task now ranks within this group's span — re-bucket auto priorities.
    await this.recomputeAutoPriorities(group.event_id);
    this.broadcastChange(group.event_id);
    return { group_id: groupId };
  }

  // Remove a task from its group; dissolve the group if it drops below 2.
  async ungroup(taskId: string, actor?: { sub: string; role: string }) {
    const task = await this.findOne(taskId);
    if (actor) await this.events.assertCanManageEvent(actor, task.event_id);
    const groupId = task.group_id;
    if (!groupId) return { ok: true };
    await this.taskRepo.update(taskId, { group_id: null });
    await this.dissolveIfTooSmall(groupId);
    // Leaving the group, the task re-ranks across the whole event timeline.
    await this.recomputeAutoPriorities(task.event_id);
    this.broadcastChange(task.event_id);
    return { ok: true };
  }

  async renameGroup(
    groupId: string,
    title: string,
    actor?: { sub: string; role: string },
  ) {
    const group = await this.groupRepo.findOne({
      where: { group_id: groupId },
    });
    if (!group)
      throw new NotFoundException('Group not found / Không tìm thấy nhóm');
    if (actor) await this.events.assertCanManageEvent(actor, group.event_id);
    await this.groupRepo.update(groupId, {
      title: (title ?? '').slice(0, 255),
    });
    this.broadcastChange(group.event_id);
    return this.groupRepo.findOne({ where: { group_id: groupId } });
  }
}
