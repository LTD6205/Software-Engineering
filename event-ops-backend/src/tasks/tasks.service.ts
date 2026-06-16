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
import { TaskGroup } from '../entities/task-group.entity';
import { TaskLog } from '../entities/task-log.entity';
import { TaskChangeLog } from '../entities/task-change-log.entity';
import { TaskCustomStatus } from '../entities/task-custom-status.entity';
import { TaskDependency } from '../entities/task-dependency.entity';
import { User } from '../entities/user.entity';
import { Event } from '../entities/event.entity';
import { EventsGateway } from '../websocket/events.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';
import {
  assertNotInPast,
  assertWithinEventWindow,
  taskBasis,
  windowOf,
  priorityFor,
} from './tasks.util';

// Everything one undoable operation did, captured so undoLastChange can reverse
// it. A manual action fills one field with a single item; one AI command or one
// multi-select batch fills it with many. (See task-change-log.entity.ts.)
export interface UndoOp {
  created: string[];
  deleted: { task: Record<string, unknown>; assignees: string[] }[];
  edited: { task_id: string; fields: Record<string, unknown> }[];
  ungrouped: {
    task_id: string;
    group_id: string | null;
    group_title?: string;
  }[];
}

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(TaskAssignment)
    private assignRepo: Repository<TaskAssignment>,
    @InjectRepository(TaskGroup) private groupRepo: Repository<TaskGroup>,
    @InjectRepository(TaskLog) private logRepo: Repository<TaskLog>,
    @InjectRepository(TaskChangeLog)
    private changeLogRepo: Repository<TaskChangeLog>,
    @InjectRepository(TaskCustomStatus)
    private customStatusRepo: Repository<TaskCustomStatus>,
    @InjectRepository(TaskDependency)
    private depRepo: Repository<TaskDependency>,
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
    // Staff see tasks they are assigned to, plus any task linked (either
    // direction) to one of their assigned tasks (read-only); managers+ see all.
    if (viewer?.role === 'staff') {
      const mine = await this.assignRepo.find({
        where: { user_id: viewer.sub },
      });
      const myTaskIds = mine.map((a) => a.task_id);
      const mySet = new Set(myTaskIds);
      const linked = await this.linkedTaskIds(myTaskIds);
      tasks = tasks.filter(
        (tk) => mySet.has(tk.task_id) || linked.has(tk.task_id),
      );
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

  async create(
    data: Partial<Task>,
    actor?: { sub: string; role: string },
    opts?: { undoOp?: UndoOp },
  ) {
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
    if (event) assertWithinEventWindow(event, data.start_time, data.deadline);
    // A new task can't be scheduled in the past.
    assertNotInPast(data.start_time, data.deadline);
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
    // Undoable: collect into the caller's batch (one AI command / multi-create) or
    // record this single create on its own. Only user/AI creates are tracked.
    if (actor?.sub) {
      if (opts?.undoOp) opts.undoOp.created.push(task.task_id);
      else {
        const op = this.newUndoOp();
        op.created.push(task.task_id);
        await this.recordOp(
          task.event_id,
          op,
          `Created "${task.task_name}"`,
          actor.sub,
        );
      }
    }
    this.broadcastChange(task.event_id);
    return this.findOne(task.task_id);
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
    'custom_status_id',
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
    // Re-bucket a single 'auto' task against a [min, span] window (the pure
    // basis/window/label math lives in tasks.util).
    const bucket = async (t: Task, min: number, span: number) => {
      if (t.priority_source !== 'auto') return;
      const b = taskBasis(t);
      if (isNaN(b)) return;
      const { label, score } = priorityFor(b, min, span, now);
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
    opts?: { undoOp?: UndoOp },
  ) {
    const old = await this.findOne(id);

    // Drop any server-controlled fields the client tried to set (event_id,
    // created_by, etc.) so an update can't move a task between events or
    // re-attribute it.
    data = this.pickUpdatable(data);

    // Editing anything other than `status`/`custom_status_id` is a manager action
    // and requires managing the task's event. Those two fields have their own
    // per-actor rules (creator/assignee) below, so a plain assignee can still
    // progress a task or set its custom progress label.
    const editsMetadata = Object.keys(data).some(
      (k) => k !== 'status' && k !== 'custom_status_id',
    );
    if (editsMetadata) {
      if (!actor || actor.role === 'staff') {
        throw new BadRequestException(
          'You are not allowed to edit this task / Bạn không có quyền chỉnh sửa công việc này',
        );
      }
      await this.events.assertCanManageEvent(actor, old.event_id);
    }

    // Setting/clearing the custom progress label is allowed for the creator or an
    // assignee (same gate as a status change), regardless of role.
    if (data.custom_status_id !== undefined && actor) {
      await this.assertCreatorOrAssignee(old, actor);
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
        assertWithinEventWindow(
          event,
          data.start_time ?? old.start_time,
          data.deadline ?? old.deadline,
        );
      }
      // A start/deadline being set can't be moved into the past. Only the
      // values present in this update are checked (not the merged old ones), so
      // editing one field of an already-running task isn't blocked by the other.
      assertNotInPast(data.start_time, data.deadline);

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
    // overwrite it (and fill in the matching score if not given). Setting the
    // source straight to 'auto' (handing the task back to the auto-prioritise
    // system) takes precedence — its label is then derived by the recompute
    // below, so we ignore any label/score sent alongside it.
    if (data.priority_source === 'auto') {
      delete data.priority_label;
      delete data.priority_score;
    } else if (data.priority_label !== undefined) {
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
      // Undoable: snapshot the OLD values of the editable fields this update set,
      // so undo can restore them. Collect into the caller's batch (one AI command)
      // or record this single edit. Only user/AI edits are tracked (system cron
      // changes have no actor), keeping the 3-slot history focused on undoable work.
      const changedKeys = Object.keys(data).filter((k) =>
        (TasksService.UPDATABLE_FIELDS as readonly string[]).includes(k),
      );
      if (changedKeys.length) {
        const fields: Record<string, unknown> = {};
        const oldRow = old as unknown as Record<string, unknown>;
        for (const k of changedKeys) fields[k] = oldRow[k];
        if (opts?.undoOp) {
          opts.undoOp.edited.push({ task_id: id, fields });
        } else {
          const labels = [
            ...new Set(
              changedKeys.map((k) => TasksService.FIELD_LABELS[k] ?? k),
            ),
          ].join(', ');
          const op = this.newUndoOp();
          op.edited.push({ task_id: id, fields });
          await this.recordOp(
            old.event_id,
            op,
            `${old.task_name} · ${labels}`,
            actor.sub,
          );
        }
      }
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
    // status change should leave priorities current). Reverting a task to the
    // 'auto' source also recomputes, so it picks up its timeline-derived label
    // immediately instead of keeping the now-stale manual one.
    if (
      data.start_time !== undefined ||
      data.deadline !== undefined ||
      data.status !== undefined ||
      data.priority_source === 'auto'
    ) {
      await this.recomputeAutoPriorities(old.event_id);
    }
    this.broadcastChange(old.event_id);
    return this.findOne(id);
  }

  // ── Undo history (per-event, bounded to the 3 most recent OPERATIONS) ────────
  // Each row is ONE operation (a manual action, one AI command, or one batch/
  // multi-select action). The op's snapshot captures everything it did so undo can
  // reverse all of it. The Undo button and the AI "undo" action both call
  // undoLastChange; repeating it walks back up to MAX_EVENT_CHANGES.
  private static readonly MAX_EVENT_CHANGES = 3;

  private static readonly FIELD_LABELS: Record<string, string> = {
    task_name: 'name',
    status: 'status',
    priority_label: 'priority',
    priority_score: 'priority',
    priority_source: 'priority',
    start_time: 'start time',
    deadline: 'deadline',
    custom_status_id: 'custom status',
  };

  newUndoOp(): UndoOp {
    return { created: [], deleted: [], edited: [], ungrouped: [] };
  }

  private static undoOpEmpty(op: UndoOp): boolean {
    return (
      !op.created.length &&
      !op.deleted.length &&
      !op.edited.length &&
      !op.ungrouped.length
    );
  }

  // A full restorable snapshot of a task (used when a delete must be undoable).
  private static taskSnapshot(t: Task): Record<string, unknown> {
    return {
      task_name: t.task_name,
      description: t.description,
      priority_label: t.priority_label,
      priority_score: t.priority_score,
      priority_source: t.priority_source,
      status: t.status,
      start_time: t.start_time,
      deadline: t.deadline,
      created_by: t.created_by,
      group_id: t.group_id,
    };
  }

  // Derive a label/category for the Undo button from what the op contains.
  private static describeOp(op: UndoOp): { type: string; label: string } {
    const parts: string[] = [];
    if (op.created.length) parts.push(`created ${op.created.length}`);
    if (op.deleted.length) parts.push(`deleted ${op.deleted.length}`);
    if (op.edited.length) parts.push(`edited ${op.edited.length}`);
    if (op.ungrouped.length) parts.push(`ungrouped ${op.ungrouped.length}`);
    const kinds = [
      op.created.length && 'create',
      op.deleted.length && 'delete',
      op.edited.length && 'edit',
      op.ungrouped.length && 'ungroup',
    ].filter(Boolean) as string[];
    return {
      type: kinds.length === 1 ? kinds[0] : 'batch',
      label: parts.join(', ') || 'change',
    };
  }

  // Write one operation as a history row (+ prune to the newest N). No-op if empty.
  async recordOp(
    eventId: string,
    op: UndoOp,
    label?: string,
    actorId?: string,
  ) {
    if (TasksService.undoOpEmpty(op)) return;
    const d = TasksService.describeOp(op);
    const refId =
      op.created[0] ??
      op.edited[0]?.task_id ??
      op.ungrouped[0]?.task_id ??
      null;
    await this.changeLogRepo.save(
      this.changeLogRepo.create({
        event_id: eventId,
        ...(refId ? { task_id: refId } : {}),
        change_type: d.type,
        snapshot: op as unknown as Record<string, unknown>,
        label: label ?? d.label,
        ...(actorId ? { actor_user_id: actorId } : {}),
      }),
    );
    await this.changeLogRepo.manager.query(
      `DELETE FROM task_change_log
         WHERE event_id = $1
           AND id NOT IN (
             SELECT id FROM task_change_log
             WHERE event_id = $1
             ORDER BY created_at DESC, id DESC
             LIMIT $2
           )`,
      [eventId, TasksService.MAX_EVENT_CHANGES],
    );
  }

  // Hard-delete a task + its child rows, WITHOUT recording undo or dissolving
  // groups (used by remove() and by undo-of-create). The change-log has no FK to
  // tasks, so it is left intact.
  private async rawDeleteTask(id: string) {
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
  }

  // Re-create a deleted task (new id) from its snapshot + assignees.
  private async restoreTask(
    eventId: string,
    snap: Record<string, unknown>,
    assignees: string[],
    fallbackCreator?: string,
  ) {
    let groupId: string | null = (snap.group_id as string | null) ?? null;
    if (groupId) {
      const g = await this.groupRepo.findOne({ where: { group_id: groupId } });
      if (!g) groupId = null; // its group was dissolved
    }
    const recreated = await this.taskRepo.save(
      this.taskRepo.create({
        event_id: eventId,
        task_name: snap.task_name as string,
        description: (snap.description as string | null) ?? null,
        priority_label: (snap.priority_label as string) ?? 'medium',
        priority_score: (snap.priority_score as number) ?? 50,
        priority_source: (snap.priority_source as string) ?? 'auto',
        status: (snap.status as string) ?? 'in_progress',
        start_time: (snap.start_time as Date | null) ?? null,
        deadline: (snap.deadline as Date | null) ?? null,
        created_by: (snap.created_by as string) ?? fallbackCreator,
        group_id: groupId,
      } as Partial<Task>),
    );
    for (const uid of assignees ?? []) {
      await this.assignRepo.save(
        this.assignRepo.create({ task_id: recreated.task_id, user_id: uid }),
      );
    }
  }

  // Put ungrouped tasks back: reuse the original group if it still exists, else
  // re-create it (with its old title) and re-attach the members.
  private async restoreGroups(
    eventId: string,
    ungrouped: {
      task_id: string;
      group_id: string | null;
      group_title?: string;
    }[],
  ) {
    const byGroup = new Map<string, { title?: string; ids: string[] }>();
    for (const u of ungrouped) {
      if (!u.group_id) continue;
      const e = byGroup.get(u.group_id) ?? { title: u.group_title, ids: [] };
      e.ids.push(u.task_id);
      byGroup.set(u.group_id, e);
    }
    for (const [gid, { title, ids }] of byGroup) {
      let group = await this.groupRepo.findOne({ where: { group_id: gid } });
      if (!group) {
        group = await this.groupRepo.save(
          this.groupRepo.create({ event_id: eventId, title: title ?? '' }),
        );
      }
      for (const tid of ids) {
        const t = await this.taskRepo.findOne({ where: { task_id: tid } });
        if (t) await this.taskRepo.update(tid, { group_id: group.group_id });
      }
    }
  }

  // The event's recent operations (newest first) for the Undo button. Manager/admin.
  async getEventChanges(
    eventId: string,
    actor?: { sub: string; role: string },
  ) {
    if (actor) await this.events.assertCanManageEvent(actor, eventId);
    const rows = await this.changeLogRepo.find({
      where: { event_id: eventId },
      order: { created_at: 'DESC' },
      take: TasksService.MAX_EVENT_CHANGES,
    });
    return rows.map((r) => ({
      id: r.id,
      change_type: r.change_type,
      label: r.label,
      created_at: r.created_at,
    }));
  }

  // Reverse the event's most recent operation in full: re-create deleted tasks,
  // re-form ungrouped ones, restore edited fields, and delete created ones. Drops
  // that history row so a repeat undo steps further back. Manager/admin gated —
  // the single path shared by the Undo button and the AI "undo" action.
  async undoLastChange(eventId: string, actor?: { sub: string; role: string }) {
    if (actor) await this.events.assertCanManageEvent(actor, eventId);
    const last = await this.changeLogRepo.findOne({
      where: { event_id: eventId },
      order: { created_at: 'DESC' },
    });
    if (!last) {
      throw new BadRequestException(
        'Nothing to undo / Không có thay đổi nào để hoàn tác',
      );
    }
    const s = (last.snapshot ?? {}) as Partial<UndoOp>;
    // 1. re-create deleted tasks
    for (const d of s.deleted ?? []) {
      await this.restoreTask(eventId, d.task, d.assignees, actor?.sub);
    }
    // 2. re-form groups that were ungrouped
    await this.restoreGroups(eventId, s.ungrouped ?? []);
    // 3. restore edited fields (only if the task still exists)
    for (const e of s.edited ?? []) {
      const restore: Partial<Task> = {};
      for (const k of Object.keys(e.fields)) {
        if ((TasksService.UPDATABLE_FIELDS as readonly string[]).includes(k)) {
          (restore[k as keyof Task] as unknown) = e.fields[k];
        }
      }
      const stillThere = await this.taskRepo.findOne({
        where: { task_id: e.task_id },
      });
      if (stillThere && Object.keys(restore).length) {
        await this.taskRepo.update(e.task_id, restore);
      }
    }
    // 4. delete created tasks
    for (const id of s.created ?? []) {
      await this.rawDeleteTask(id);
    }
    await this.changeLogRepo.delete({ id: last.id });
    await this.recomputeEventStatus(eventId);
    await this.recomputeAutoPriorities(eventId);
    this.broadcastChange(eventId);
    return { undone: { type: last.change_type, label: last.label } };
  }

  async remove(
    id: string,
    actor?: { sub: string; role: string },
    opts?: { undoOp?: UndoOp },
  ) {
    const task = await this.findOne(id);
    if (actor) await this.events.assertCanManageEvent(actor, task.event_id);
    // Capture an undoable snapshot (task + assignees) BEFORE deleting — it must
    // survive the delete so undo can re-create the task. Collect into the caller's
    // batch (one AI command / multi-select) or record this single delete on its own.
    if (actor?.sub) {
      const assignees = (
        await this.assignRepo.find({ where: { task_id: id } })
      ).map((a) => a.user_id);
      const entry = { task: TasksService.taskSnapshot(task), assignees };
      if (opts?.undoOp) opts.undoOp.deleted.push(entry);
      else {
        const op = this.newUndoOp();
        op.deleted.push(entry);
        await this.recordOp(
          task.event_id,
          op,
          `Deleted "${task.task_name}"`,
          actor.sub,
        );
      }
    }
    await this.rawDeleteTask(id);
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

  // Delete several tasks (multi-select) as ONE undoable operation. Each task is
  // removed via remove() (per-task auth + group dissolve), collecting one batched
  // delete entry that undo re-creates together.
  async removeMany(ids: string[], actor?: { sub: string; role: string }) {
    if (!ids.length) return { message: 'No tasks to delete' };
    const first = await this.findOne(ids[0]);
    const op = this.newUndoOp();
    for (const id of ids) await this.remove(id, actor, { undoOp: op });
    if (actor?.sub) {
      await this.recordOp(
        first.event_id,
        op,
        `Deleted ${op.deleted.length} task(s)`,
        actor.sub,
      );
    }
    return { message: `Deleted ${ids.length} task(s)` };
  }

  // Ungroup several tasks (multi-select) as ONE undoable operation.
  async ungroupMany(ids: string[], actor?: { sub: string; role: string }) {
    if (!ids.length) return { message: 'No tasks to ungroup' };
    const first = await this.findOne(ids[0]);
    const op = this.newUndoOp();
    const affectedGroups = new Set<string>();
    // Capture every membership BEFORE unsetting any — removing one member can
    // dissolve a small group and null the others' group_id, which would otherwise
    // be lost from the undo snapshot. Then unset all, then dissolve once.
    for (const id of ids) {
      const t = await this.findOne(id);
      if (actor) await this.events.assertCanManageEvent(actor, t.event_id);
      if (!t.group_id) continue;
      const group = await this.groupRepo.findOne({
        where: { group_id: t.group_id },
      });
      op.ungrouped.push({
        task_id: id,
        group_id: t.group_id,
        group_title: group?.title,
      });
      affectedGroups.add(t.group_id);
      await this.taskRepo.update(id, { group_id: null });
    }
    for (const gid of affectedGroups) await this.dissolveIfTooSmall(gid);
    if (actor?.sub && op.ungrouped.length) {
      await this.recordOp(
        first.event_id,
        op,
        `Ungrouped ${op.ungrouped.length} task(s)`,
        actor.sub,
      );
    }
    await this.recomputeAutoPriorities(first.event_id);
    this.broadcastChange(first.event_id);
    return { message: `Ungrouped ${op.ungrouped.length} task(s)` };
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

  // The creator of a task or any of its assignees — the gate shared by status
  // changes, custom-status edits, and task linking.
  private async assertCreatorOrAssignee(
    task: Task,
    actor: { sub: string; role: string },
  ) {
    const assignments = await this.assignRepo.find({
      where: { task_id: task.task_id },
    });
    const isCreator = task.created_by === actor.sub;
    const isAssigned = assignments.some((a) => a.user_id === actor.sub);
    if (!isCreator && !isAssigned) {
      throw new BadRequestException(
        'You are not allowed to change this task / Bạn không có quyền thay đổi công việc này',
      );
    }
  }

  // ── Custom statuses (reusable per-event progress labels) ────

  async listCustomStatuses(
    eventId: string,
    viewer: { sub: string; role: string },
  ) {
    await this.events.assertCanViewEvent(viewer, eventId);
    return this.customStatusRepo.find({
      where: { event_id: eventId },
      order: { created_at: 'ASC' },
    });
  }

  async createCustomStatus(
    eventId: string,
    data: { name: string; color?: string | null },
    actor: { sub: string; role: string },
  ) {
    // Any member of the event (manager or staff) may define a status.
    await this.events.assertCanViewEvent(actor, eventId);
    const name = (data.name ?? '').trim();
    if (!name) {
      throw new BadRequestException(
        'Status name is required / Cần có tên trạng thái',
      );
    }
    const existing = await this.customStatusRepo
      .createQueryBuilder('s')
      .where('s.event_id = :eventId', { eventId })
      .andWhere('lower(s.name) = lower(:name)', { name })
      .getOne();
    if (existing) {
      throw new BadRequestException(
        'A status with this name already exists / Trạng thái này đã tồn tại',
      );
    }
    const row = this.customStatusRepo.create({
      event_id: eventId,
      name,
      color: data.color ?? null,
      created_by: actor.sub,
    });
    const saved = await this.customStatusRepo.save(row);
    this.broadcastChange(eventId);
    return saved;
  }

  // Resolve a custom-status name to its row within an event (case-insensitive).
  // Used by the AI to turn a model-supplied status name into an id. Null if none.
  findCustomStatusByName(eventId: string, name: string) {
    return this.customStatusRepo
      .createQueryBuilder('s')
      .where('s.event_id = :eventId', { eventId })
      .andWhere('lower(s.name) = lower(:name)', { name: (name ?? '').trim() })
      .getOne();
  }

  async deleteCustomStatus(
    statusId: string,
    actor: { sub: string; role: string },
  ) {
    const row = await this.customStatusRepo.findOne({
      where: { status_id: statusId },
    });
    if (!row) {
      throw new NotFoundException(
        'Custom status not found / Không tìm thấy trạng thái',
      );
    }
    // The creator may delete their own; anyone else must manage the event.
    if (row.created_by === actor.sub) {
      await this.events.assertCanViewEvent(actor, row.event_id);
    } else {
      await this.events.assertCanManageEvent(actor, row.event_id);
    }
    // FK is ON DELETE SET NULL, so any tasks using it are detached automatically.
    await this.customStatusRepo.delete({ status_id: statusId });
    this.broadcastChange(row.event_id);
    return { message: 'Custom status deleted / Đã xoá trạng thái' };
  }

  // ── Task links (symmetric "related" relationship over task_dependencies) ──

  // Managers/admin who manage the event, or staff who are the task's creator or
  // an assignee, may link/unlink it.
  private async assertCanLink(
    task: Task,
    actor: { sub: string; role: string },
  ) {
    if (
      actor.role === 'manager' ||
      actor.role === 'admin' ||
      actor.role === 'organizer'
    ) {
      await this.events.assertCanManageEvent(actor, task.event_id);
      return;
    }
    await this.assertCreatorOrAssignee(task, actor);
  }

  // The set of task ids linked (in either direction) to any of the given tasks.
  private async linkedTaskIds(taskIds: string[]): Promise<Set<string>> {
    if (taskIds.length === 0) return new Set();
    const rows: Array<{ task_id: string; depends_on_task: string }> =
      await this.depRepo.manager.query(
        `SELECT task_id, depends_on_task FROM task_dependencies
         WHERE task_id = ANY($1::uuid[]) OR depends_on_task = ANY($1::uuid[])`,
        [taskIds],
      );
    const out = new Set<string>();
    for (const r of rows) {
      out.add(r.task_id);
      out.add(r.depends_on_task);
    }
    return out;
  }

  async linkTasks(
    taskId: string,
    targetId: string,
    actor: { sub: string; role: string },
  ) {
    if (taskId === targetId) {
      throw new BadRequestException(
        'Cannot link a task to itself / Không thể liên kết công việc với chính nó',
      );
    }
    const a = await this.findOne(taskId);
    const b = await this.findOne(targetId);
    if (a.event_id !== b.event_id) {
      throw new BadRequestException(
        'Tasks must be in the same event / Công việc phải cùng một sự kiện',
      );
    }
    // Authorize on the SOURCE task only (by design): a staffer anchors a link
    // from a task they own/are assigned to, to any other task in the SAME event
    // — that is exactly the intended way they surface a teammate's task into
    // their read-only view (see the linked-task visibility rule in
    // findAllByEvent). Requiring ownership of the target too would make the
    // feature useless for staff. Same-event is already enforced above, and a
    // manager actor's assertCanManageEvent(a.event_id) covers B as well since
    // both share the event.
    await this.assertCanLink(a, actor);
    // Symmetric: only create when no link exists in either direction.
    const existing = await this.depRepo
      .createQueryBuilder('d')
      .where(
        '(d.task_id = :a AND d.depends_on_task = :b) OR (d.task_id = :b AND d.depends_on_task = :a)',
        { a: taskId, b: targetId },
      )
      .getOne();
    if (!existing) {
      await this.depRepo.save(
        this.depRepo.create({ task_id: taskId, depends_on_task: targetId }),
      );
    }
    this.broadcastChange(a.event_id);
    return { message: 'Linked / Đã liên kết' };
  }

  async unlinkTasks(
    taskId: string,
    targetId: string,
    actor: { sub: string; role: string },
  ) {
    const a = await this.findOne(taskId);
    await this.assertCanLink(a, actor);
    await this.depRepo
      .createQueryBuilder()
      .delete()
      .where(
        '(task_id = :a AND depends_on_task = :b) OR (task_id = :b AND depends_on_task = :a)',
        { a: taskId, b: targetId },
      )
      .execute();
    this.broadcastChange(a.event_id);
    return { message: 'Unlinked / Đã gỡ liên kết' };
  }

  async getLinks(taskId: string, viewer: { sub: string; role: string }) {
    const task = await this.findOne(taskId);
    await this.events.assertCanViewEvent(viewer, task.event_id);
    const ids = await this.linkedTaskIds([taskId]);
    ids.delete(taskId);
    if (ids.size === 0) return [];
    return this.taskRepo.find({ where: { task_id: In(Array.from(ids)) } });
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

  // A task may only be assigned to staff members, with one exception: a
  // manager/admin may assign a task to *themselves*. A manager may otherwise only
  // assign their own staff; admins/organizers may assign any staff member.
  private async assertAssignable(
    userId: string,
    actor?: { sub: string; role: string },
  ) {
    const u = await this.userRepo.findOne({ where: { user_id: userId } });
    if (!u) {
      throw new NotFoundException('User not found / Không tìm thấy người dùng');
    }
    // Self-assignment: a manager/admin can put a task on their own plate even
    // though their role is not 'staff'.
    const isSelf =
      !!actor &&
      actor.sub === userId &&
      (actor.role === 'manager' || actor.role === 'admin');
    if (!isSelf && u.role !== 'staff') {
      throw new BadRequestException(
        'Tasks can only be assigned to staff members / Chỉ có thể giao công việc cho nhân viên',
      );
    }
    // A manager may only assign their *own* staff (self-assignment already passed).
    if (
      actor &&
      actor.role === 'manager' &&
      u.role === 'staff' &&
      u.manager_id !== actor.sub
    ) {
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
  async ungroup(
    taskId: string,
    actor?: { sub: string; role: string },
    opts?: { undoOp?: UndoOp },
  ) {
    const task = await this.findOne(taskId);
    if (actor) await this.events.assertCanManageEvent(actor, task.event_id);
    const groupId = task.group_id;
    if (!groupId) return { ok: true };
    // Capture the membership so undo can put the task back (with the group's title
    // in case removing it dissolves the group).
    const group = await this.groupRepo.findOne({
      where: { group_id: groupId },
    });
    const entry = {
      task_id: taskId,
      group_id: groupId,
      group_title: group?.title,
    };
    await this.taskRepo.update(taskId, { group_id: null });
    await this.dissolveIfTooSmall(groupId);
    if (actor?.sub) {
      if (opts?.undoOp) opts.undoOp.ungrouped.push(entry);
      else {
        const op = this.newUndoOp();
        op.ungrouped.push(entry);
        await this.recordOp(
          task.event_id,
          op,
          `Removed "${task.task_name}" from its group`,
          actor.sub,
        );
      }
    }
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
