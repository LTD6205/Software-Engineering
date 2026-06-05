import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiRequest } from '../entities/ai-request.entity';
import { AiTaskMap } from '../entities/ai-task-map.entity';
import { User } from '../entities/user.entity';
import { TasksService } from '../tasks/tasks.service';
import { EventsService } from '../events/events.service';
import {
  Actor,
  CommandOptions,
  ExecResult,
  AiActionKind,
  UnassignAction,
  DeleteAction,
  MergeAction,
  AddToGroupAction,
  RenameGroupAction,
  UngroupAction,
} from './ai.types';
import { isActionAllowedForRole } from './ai.authz';
import axios from 'axios';

type Priority = 'low' | 'medium' | 'high';

// The AI may now return a list of *actions*, not just new tasks, so a single
// natural-language command can also reschedule, re-prioritise, rename, change
// status, or reassign existing tasks ("push everything back two days", "move
// Bob's tasks to Carol"). For backward compatibility an item with no `action`
// field is treated as a `create` (the original array-of-tasks behaviour).
//   create   — add a new task (task_name + optional priority/assignee/deadline)
//   update   — change an existing task's name/priority/deadline/status
//   reassign — replace an existing task's assignee
// split_task / add_dependency are intentionally not supported yet (the latter
// needs the currently-unused task_dependencies table).
interface CreateAction {
  action: 'create';
  task_name: string;
  priority: Priority;
  assigned_to: string;
  deadline: string;
  // Optional group title: new tasks sharing the same group are linked into one
  // task group after the action loop (see executeActions).
  group?: string;
}
interface UpdateAction {
  action: 'update';
  task_ref: string; // existing task id or (case-insensitive) name
  task_name?: string;
  priority?: Priority;
  deadline?: string;
  status?: 'in_progress' | 'completed' | 'overdue';
}
interface ReassignAction {
  action: 'reassign';
  task_ref: string;
  assigned_to: string;
}
type AiAction =
  | CreateAction
  | UpdateAction
  | ReassignAction
  | UnassignAction
  | DeleteAction
  | MergeAction
  | AddToGroupAction
  | RenameGroupAction
  | UngroupAction;

// A task as listed for the model (and for resolving a task_ref to a real row).
interface TaskRef {
  task_id: string;
  task_name: string;
}

// The provider is any OpenAI-compatible chat-completions API (DeepSeek, OpenAI,
// Together, a local Ollama/vLLM endpoint, …) — selected via AI_BASE_URL /
// AI_MODEL / AI_API_KEY in the environment, not hard-coded to one vendor.
interface ChatCompletionResponse {
  choices: { message: { content: string } }[];
}

// OpenAI-compatible defaults point at DeepSeek so an existing DEEPSEEK_API_KEY
// setup keeps working without any new config.
const DEFAULT_AI_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_AI_MODEL = 'deepseek-chat';

@Injectable()
export class AiService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(AiRequest) private aiRequestRepo: Repository<AiRequest>,
    @InjectRepository(AiTaskMap) private aiTaskMapRepo: Repository<AiTaskMap>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private readonly tasksService: TasksService,
    private readonly events: EventsService,
  ) {}

  // Simple in-memory per-user rate limit for this expensive external endpoint.
  private static readonly RATE_LIMIT = 20; // requests…
  private static readonly RATE_WINDOW_MS = 10 * 60 * 1000; // …per 10 minutes
  private readonly recentCalls = new Map<string, number[]>();

  private assertWithinRateLimit(userId: string) {
    const now = Date.now();
    const cutoff = now - AiService.RATE_WINDOW_MS;
    const calls = (this.recentCalls.get(userId) ?? []).filter(
      (t) => t > cutoff,
    );
    if (calls.length >= AiService.RATE_LIMIT) {
      throw new HttpException(
        'Too many AI requests — please wait a moment. / Quá nhiều yêu cầu AI — vui lòng đợi một lát.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    calls.push(now);
    this.recentCalls.set(userId, calls);
  }

  private static priorityScore(p: Priority): number {
    return p === 'high' ? 90 : p === 'medium' ? 50 : 10;
  }

  private static normalisePriority(p: unknown): Priority {
    return p === 'high' || p === 'low' ? p : 'medium';
  }

  // Parse a model deadline string into a Date, dropping anything unparseable so
  // an "Invalid Date" is never persisted. Returns undefined when absent/invalid.
  private static parseDeadline(value: unknown): Date | undefined {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const d = new Date(value);
    return isNaN(d.getTime()) ? undefined : d;
  }

  // Runtime validation of the model's JSON array of actions. Unknown/missing
  // `action` defaults to 'create' (backward compatible with the old
  // array-of-tasks format). Malformed items (e.g. a create with no name, or an
  // update/reassign with no task_ref) are dropped and counted.
  private validateActions(parsed: unknown[]): {
    actions: AiAction[];
    skipped: number;
  } {
    const actions: AiAction[] = [];
    let skipped = 0;
    for (const raw of parsed) {
      const item = (raw ?? {}) as Record<string, unknown>;
      const action =
        typeof item.action === 'string' ? item.action.toLowerCase() : 'create';
      const ref = typeof item.task_ref === 'string' ? item.task_ref.trim() : '';
      const name =
        typeof item.task_name === 'string' ? item.task_name.trim() : '';
      const assignedTo =
        typeof item.assigned_to === 'string' ? item.assigned_to : '';
      const targetRef =
        typeof item.target_ref === 'string' ? item.target_ref.trim() : '';
      const groupRef =
        typeof item.group_ref === 'string' ? item.group_ref.trim() : '';
      const title = typeof item.title === 'string' ? item.title.trim() : '';

      if (action === 'update') {
        if (!ref) {
          skipped++;
          continue;
        }
        const status =
          item.status === 'in_progress' ||
          item.status === 'completed' ||
          item.status === 'overdue'
            ? item.status
            : undefined;
        // An update that changes nothing usable is dropped.
        if (
          !name &&
          item.priority === undefined &&
          item.deadline === undefined &&
          !status
        ) {
          skipped++;
          continue;
        }
        actions.push({
          action: 'update',
          task_ref: ref,
          ...(name ? { task_name: name } : {}),
          ...(item.priority !== undefined
            ? { priority: AiService.normalisePriority(item.priority) }
            : {}),
          ...(typeof item.deadline === 'string'
            ? { deadline: item.deadline }
            : {}),
          ...(status ? { status } : {}),
        });
      } else if (action === 'reassign') {
        if (!ref || !assignedTo.trim()) {
          skipped++;
          continue;
        }
        actions.push({
          action: 'reassign',
          task_ref: ref,
          assigned_to: assignedTo,
        });
      } else if (action === 'unassign') {
        if (!ref) {
          skipped++;
          continue;
        }
        actions.push({ action: 'unassign', task_ref: ref });
      } else if (action === 'delete') {
        if (!ref) {
          skipped++;
          continue;
        }
        actions.push({ action: 'delete', task_ref: ref });
      } else if (action === 'merge') {
        if (!ref || !targetRef) {
          skipped++;
          continue;
        }
        actions.push({ action: 'merge', task_ref: ref, target_ref: targetRef });
      } else if (action === 'add_to_group') {
        if (!groupRef || !ref) {
          skipped++;
          continue;
        }
        actions.push({
          action: 'add_to_group',
          group_ref: groupRef,
          task_ref: ref,
        });
      } else if (action === 'rename_group') {
        if (!groupRef || !title) {
          skipped++;
          continue;
        }
        actions.push({ action: 'rename_group', group_ref: groupRef, title });
      } else if (action === 'ungroup') {
        if (!ref) {
          skipped++;
          continue;
        }
        actions.push({ action: 'ungroup', task_ref: ref });
      } else {
        // create (default)
        if (!name) {
          skipped++;
          continue;
        }
        const group =
          typeof item.group === 'string' && item.group.trim()
            ? item.group.trim()
            : undefined;
        actions.push({
          action: 'create',
          task_name: name,
          priority: AiService.normalisePriority(item.priority),
          assigned_to: assignedTo,
          deadline: typeof item.deadline === 'string' ? item.deadline : '',
          ...(group ? { group } : {}),
        });
      }
    }
    return { actions, skipped };
  }

  // Resolve a model-supplied task_ref to a real task in this event: an exact id
  // match first, else a case-insensitive name match. Null when no match.
  private resolveTaskRef(ref: string, tasks: TaskRef[]): TaskRef | null {
    const needle = ref.trim().toLowerCase();
    return (
      tasks.find((t) => t.task_id.toLowerCase() === needle) ??
      tasks.find((t) => t.task_name.trim().toLowerCase() === needle) ??
      null
    );
  }

  // Resolve a model-supplied group_ref to a real group id in this event: an
  // exact id match first, else a case-insensitive group-title match. Null when
  // no match.
  private resolveGroupRef(
    ref: string,
    groupIds: Set<string>,
    groupByTitle: Map<string, string>,
  ): string | null {
    const needle = ref.trim().toLowerCase();
    if (groupIds.has(ref)) return ref;
    return groupByTitle.get(needle) ?? null;
  }

  // Turn a thrown service error into a short, client-safe reason string.
  private reason(e: unknown): string {
    return e instanceof HttpException
      ? (e.getResponse() as { message?: string }).message || e.message
      : 'Action failed';
  }

  // Resolve an AI-provided "assigned_to" string (name or email) to a real,
  // active user. Returns null when no confident match is found.
  private async resolveAssignee(assignedTo?: string): Promise<User | null> {
    const needle = assignedTo?.trim();
    if (!needle) return null;
    return this.userRepo.findOne({
      where: [
        { email: needle, is_active: true },
        { name: needle, is_active: true },
      ],
    });
  }

  // Assign a task to an AI-named user if one matches. Permission failures (an
  // out-of-team assignee) are swallowed so the task is simply left unassigned
  // rather than aborting the whole command.
  private async tryAssign(taskId: string, assignedTo: string, actor: Actor) {
    const assignee = await this.resolveAssignee(assignedTo);
    if (!assignee) return;
    try {
      await this.tasksService.assignUser(taskId, assignee.user_id, actor);
    } catch {
      // Leave the task unassigned if the suggestion isn't permitted.
    }
  }

  // All result buckets, empty. Each kind of action writes into its own bucket.
  private emptyResult(): ExecResult {
    return {
      tasks_created: [],
      tasks_updated: [],
      tasks_reassigned: [],
      tasks_deleted: [],
      unassigned: [],
      groups_changed: [],
      events_changed: [],
      users_changed: [],
      unresolved: [],
      rejected: [],
      skipped: 0,
    };
  }

  // Load the event's task list and task-group context, shared by processCommand
  // (to build the prompt + resolve refs) and confirmCommand (to re-resolve refs
  // when applying a stored plan). When no eventId is supplied (cross-event
  // commands) this returns empty context without touching the DB.
  private async loadEventContext(
    eventId: string | undefined,
    actor: Actor,
  ): Promise<{
    currentTasks: TaskRef[];
    groupIds: Set<string>;
    groupByTitle: Map<string, string>;
  }> {
    const groupByTitle = new Map<string, string>(); // lower(title) -> group_id
    const groupIds = new Set<string>();
    if (!eventId) {
      return { currentTasks: [], groupIds, groupByTitle };
    }
    const rows = (await this.tasksService.findAllByEvent(
      eventId,
      actor,
    )) as Array<{
      task_id: string;
      task_name: string;
      group_id?: string;
      group_title?: string;
    }>;
    const currentTasks: TaskRef[] = rows.map((t) => ({
      task_id: t.task_id,
      task_name: t.task_name,
    }));
    for (const t of rows) {
      if (t.group_id) {
        groupIds.add(t.group_id);
        if (t.group_title)
          groupByTitle.set(t.group_title.trim().toLowerCase(), t.group_id);
      }
    }
    return { currentTasks, groupIds, groupByTitle };
  }

  // Produce a human-readable, one-line-per-action preview of a validated plan,
  // shown to the user in Ask mode before they confirm or cancel.
  private describePlan(
    actions: AiAction[],
    currentTasks: TaskRef[],
    groupIds: Set<string>,
    groupByTitle: Map<string, string>,
  ): { kind: string; description: string }[] {
    const taskName = (ref: string): string => {
      const t = this.resolveTaskRef(ref, currentTasks);
      return t ? t.task_name : ref;
    };
    const groupName = (ref: string): string => {
      const gid = this.resolveGroupRef(ref, groupIds, groupByTitle);
      if (!gid) return ref;
      for (const [title, id] of groupByTitle) if (id === gid) return title;
      return ref;
    };
    return actions.map((item) => {
      switch (item.action) {
        case 'create':
          return {
            kind: 'create',
            description: `Create "${item.task_name}"`,
          };
        case 'update':
          return {
            kind: 'update',
            description: `Update task "${taskName(item.task_ref)}"`,
          };
        case 'reassign':
          return {
            kind: 'reassign',
            description: `Reassign "${taskName(item.task_ref)}" to ${item.assigned_to}`,
          };
        case 'unassign':
          return {
            kind: 'unassign',
            description: `Unassign "${taskName(item.task_ref)}"`,
          };
        case 'delete':
          return {
            kind: 'delete',
            description: `Delete task "${taskName(item.task_ref)}"`,
          };
        case 'merge':
          return {
            kind: 'merge',
            description: `Merge "${taskName(item.task_ref)}" into "${taskName(item.target_ref)}"`,
          };
        case 'add_to_group':
          return {
            kind: 'add_to_group',
            description: `Add "${taskName(item.task_ref)}" to group "${groupName(item.group_ref)}"`,
          };
        case 'rename_group':
          return {
            kind: 'rename_group',
            description: `Rename group "${groupName(item.group_ref)}" to "${item.title}"`,
          };
        case 'ungroup':
          return {
            kind: 'ungroup',
            description: `Remove "${taskName(item.task_ref)}" from its group`,
          };
        default:
          return { kind: 'unknown', description: 'Unknown action' };
      }
    });
  }

  // Single execution path for the validated action list. `currentTasks` is the
  // resolvable task list (mutated as creates land); `defaultEventId` is the
  // request event used when an action omits an explicit event. The actor's role
  // gates each action up front — a disallowed action is recorded in `rejected`
  // and skipped (this is the hard role gate; not every service self-enforces).
  private async executeActions(
    actions: AiAction[],
    currentTasks: TaskRef[],
    defaultEventId: string | undefined,
    actor: Actor,
    aiRequestId: string,
    groupIds: Set<string>,
    groupByTitle: Map<string, string>,
  ): Promise<ExecResult> {
    const res = this.emptyResult();
    // New tasks tagged with a `group` title, collected as creates land and
    // linked into one task group after the loop.
    const createdGroups: { taskId: string; title: string }[] = [];
    for (const item of actions) {
      if (
        !isActionAllowedForRole(
          actor.role,
          (item as { action: AiActionKind }).action,
        )
      ) {
        res.rejected.push({
          ref:
            (item as { task_ref?: string }).task_ref ??
            (item as { task_name?: string }).task_name ??
            item.action,
          reason: `Your role (${actor.role}) cannot perform "${item.action}"`,
        });
        continue;
      }
      await this.runAction(
        item,
        currentTasks,
        defaultEventId,
        actor,
        aiRequestId,
        res,
        groupIds,
        groupByTitle,
        createdGroups,
      );
    }
    // Link newly-created tasks that share a group title. Reuse an existing event
    // group with that title if present, else chain members via merge (the first
    // pair creates the group; subsequent members add to it).
    const byTitle = new Map<string, string[]>();
    for (const g of createdGroups) {
      const arr = byTitle.get(g.title.toLowerCase()) ?? [];
      arr.push(g.taskId);
      byTitle.set(g.title.toLowerCase(), arr);
    }
    for (const [title, taskIds] of byTitle) {
      const existing = groupByTitle.get(title);
      try {
        if (existing) {
          for (const id of taskIds)
            await this.tasksService.addToGroup(existing, id, actor);
          res.groups_changed.push({
            action: 'add_to_group',
            group_id: existing,
            title,
          });
        } else if (taskIds.length >= 2) {
          const g = await this.tasksService.merge(
            taskIds[0],
            taskIds[1],
            actor,
          );
          const gid = (g as { group_id?: string }).group_id;
          for (const id of taskIds.slice(2))
            if (gid) await this.tasksService.addToGroup(gid, id, actor);
          res.groups_changed.push({ action: 'merge', group_id: gid, title });
        }
      } catch (e) {
        res.rejected.push({ ref: title, reason: this.reason(e) });
      }
    }
    return res;
  }

  // Execute one already-role-allowed action, writing its outcome into `res`.
  private async runAction(
    item: AiAction,
    currentTasks: TaskRef[],
    defaultEventId: string | undefined,
    actor: Actor,
    aiRequestId: string,
    res: ExecResult,
    groupIds: Set<string>,
    groupByTitle: Map<string, string>,
    createdGroups: { taskId: string; title: string }[],
  ): Promise<void> {
    switch (item.action) {
      case 'create': {
        // event_ref resolution arrives in Phase 4; for now every create lands
        // in the request event.
        const eventId = defaultEventId;
        let task: { task_id: string; task_name: string };
        try {
          task = await this.tasksService.create(
            {
              event_id: eventId,
              task_name: item.task_name,
              priority_label: item.priority,
              priority_score: AiService.priorityScore(item.priority),
              priority_source: 'ai',
              deadline: AiService.parseDeadline(item.deadline),
            },
            actor,
          );
        } catch (e) {
          // A disallowed create (deadline outside the event window or in the
          // past) is skipped with a reason rather than failing the whole
          // command, so the other tasks in the same prompt still go through.
          res.rejected.push({
            ref: item.task_name,
            reason:
              e instanceof HttpException
                ? (e.getResponse() as { message?: string }).message || e.message
                : 'Could not be created',
          });
          return;
        }
        // Assign if the AI named a matchable user. The assignment obeys the
        // same rules as a manual one (actor manages the event and, for a plain
        // manager, the assignee is their own staff), so an out-of-team
        // suggestion is skipped rather than failing the whole command.
        await this.tryAssign(task.task_id, item.assigned_to, actor);
        await this.aiTaskMapRepo.save({
          request_id: aiRequestId,
          task_id: task.task_id,
        });
        // Let later update/reassign actions reference this new task by name.
        currentTasks.push({
          task_id: task.task_id,
          task_name: task.task_name,
        });
        // Record group membership so same-titled creates are linked after the
        // loop.
        if (item.group && item.group.trim()) {
          createdGroups.push({
            taskId: task.task_id,
            title: item.group.trim(),
          });
        }
        res.tasks_created.push({ ...task });
        return;
      }

      case 'update': {
        const target = this.resolveTaskRef(item.task_ref, currentTasks);
        if (!target) {
          res.unresolved.push(item.task_ref);
          return;
        }
        const patch: Record<string, unknown> = {};
        if (item.task_name) patch.task_name = item.task_name;
        if (item.priority) {
          patch.priority_label = item.priority;
          patch.priority_score = AiService.priorityScore(item.priority);
        }
        if (item.deadline !== undefined) {
          const d = AiService.parseDeadline(item.deadline);
          if (d) patch.deadline = d;
        }
        if (item.status) patch.status = item.status;
        if (Object.keys(patch).length === 0) return;
        try {
          const task = await this.tasksService.update(
            target.task_id,
            patch,
            actor,
          );
          await this.aiTaskMapRepo.save({
            request_id: aiRequestId,
            task_id: target.task_id,
          });
          res.tasks_updated.push({ ...task });
        } catch {
          // A disallowed edit (e.g. moving a deadline into the past) is skipped
          // rather than failing the whole command.
          res.unresolved.push(item.task_ref);
        }
        return;
      }

      case 'reassign': {
        const target = this.resolveTaskRef(item.task_ref, currentTasks);
        if (!target) {
          res.unresolved.push(item.task_ref);
          return;
        }
        // reassign — replace the task's assignee set with the matched user.
        const assignee = await this.resolveAssignee(item.assigned_to);
        if (!assignee) {
          res.unresolved.push(item.assigned_to);
          return;
        }
        try {
          await this.tasksService.setAssignees(
            target.task_id,
            [assignee.user_id],
            actor,
          );
          await this.aiTaskMapRepo.save({
            request_id: aiRequestId,
            task_id: target.task_id,
          });
          res.tasks_reassigned.push({
            task_id: target.task_id,
            task_name: target.task_name,
            assigned_to: assignee.user_id,
          });
        } catch {
          res.unresolved.push(item.task_ref);
        }
        return;
      }

      case 'unassign': {
        const t = this.resolveTaskRef(item.task_ref, currentTasks);
        if (!t) {
          res.unresolved.push(item.task_ref);
          return;
        }
        try {
          await this.tasksService.setAssignees(t.task_id, [], actor);
          res.unassigned.push({ task_id: t.task_id, task_name: t.task_name });
        } catch (e) {
          res.rejected.push({ ref: item.task_ref, reason: this.reason(e) });
        }
        return;
      }

      case 'delete': {
        const t = this.resolveTaskRef(item.task_ref, currentTasks);
        if (!t) {
          res.unresolved.push(item.task_ref);
          return;
        }
        try {
          await this.tasksService.remove(t.task_id, actor);
          res.tasks_deleted.push({
            task_id: t.task_id,
            task_name: t.task_name,
          });
        } catch (e) {
          res.rejected.push({ ref: item.task_ref, reason: this.reason(e) });
        }
        return;
      }

      case 'merge': {
        const s = this.resolveTaskRef(item.task_ref, currentTasks);
        const tg = this.resolveTaskRef(item.target_ref, currentTasks);
        if (!s || !tg) {
          res.unresolved.push(!s ? item.task_ref : item.target_ref);
          return;
        }
        try {
          const g = await this.tasksService.merge(s.task_id, tg.task_id, actor);
          res.groups_changed.push({
            action: 'merge',
            group_id: (g as { group_id?: string }).group_id,
          });
        } catch (e) {
          res.rejected.push({ ref: item.task_ref, reason: this.reason(e) });
        }
        return;
      }

      case 'add_to_group': {
        const gid = this.resolveGroupRef(item.group_ref, groupIds, groupByTitle);
        const t = this.resolveTaskRef(item.task_ref, currentTasks);
        if (!gid || !t) {
          res.unresolved.push(!gid ? item.group_ref : item.task_ref);
          return;
        }
        try {
          await this.tasksService.addToGroup(gid, t.task_id, actor);
          res.groups_changed.push({ action: 'add_to_group', group_id: gid });
        } catch (e) {
          res.rejected.push({ ref: item.task_ref, reason: this.reason(e) });
        }
        return;
      }

      case 'rename_group': {
        const gid = this.resolveGroupRef(item.group_ref, groupIds, groupByTitle);
        if (!gid) {
          res.unresolved.push(item.group_ref);
          return;
        }
        try {
          await this.tasksService.renameGroup(gid, item.title, actor);
          res.groups_changed.push({
            action: 'rename_group',
            group_id: gid,
            title: item.title,
          });
        } catch (e) {
          res.rejected.push({ ref: item.group_ref, reason: this.reason(e) });
        }
        return;
      }

      case 'ungroup': {
        const t = this.resolveTaskRef(item.task_ref, currentTasks);
        if (!t) {
          res.unresolved.push(item.task_ref);
          return;
        }
        try {
          await this.tasksService.ungroup(t.task_id, actor);
          res.groups_changed.push({ action: 'ungroup' });
        } catch (e) {
          res.rejected.push({ ref: item.task_ref, reason: this.reason(e) });
        }
        return;
      }
    }
  }

  async processCommand(actor: Actor, opts: CommandOptions): Promise<object> {
    const { message: userMessage } = opts;
    // eventId is optional on the DTO (cross-event commands arrive in later
    // phases); today's task-scoped flow always carries one. Coerce so the
    // existing event-scoped calls keep their non-optional contract.
    const eventId = opts.eventId ?? '';
    const userId = actor.sub;
    if (!userMessage || !userMessage.trim()) {
      throw new BadRequestException(
        'A command message is required / Vui lòng nhập nội dung lệnh',
      );
    }
    // The actor may only drive AI changes on an event they manage — checked
    // before we spend an external AI call.
    await this.events.assertCanManageEvent(actor, eventId);
    // Throttle this expensive endpoint per user.
    this.assertWithinRateLimit(userId);
    // Don't attempt an external call with a missing key (would send
    // "Bearer undefined" and leak a confusing provider error to the client).
    // AI_API_KEY is preferred; DEEPSEEK_API_KEY is kept as a backward-compatible
    // fallback for existing setups.
    const apiKey =
      this.config.get<string>('AI_API_KEY') ||
      this.config.get<string>('DEEPSEEK_API_KEY');
    if (!apiKey) {
      throw new BadRequestException(
        'The AI assistant is not configured / Trợ lý AI chưa được cấu hình',
      );
    }
    const baseUrl = (
      this.config.get<string>('AI_BASE_URL') || DEFAULT_AI_BASE_URL
    ).replace(/\/+$/, '');
    const model = this.config.get<string>('AI_MODEL') || DEFAULT_AI_MODEL;

    // Give the model the event's current tasks so it can target existing ones
    // for update/reassign (not just create new ones), plus the task-group
    // context so group_ref/title can be resolved. Viewer-scoped read; the actor
    // already passed the manage check above.
    const { currentTasks, groupIds, groupByTitle } =
      await this.loadEventContext(eventId, actor);
    const taskList = currentTasks.length
      ? currentTasks
          .map((t) => `- "${t.task_name}" (id ${t.task_id})`)
          .join('\n')
      : '(no tasks yet)';

    // Tell the model the event's date window (and "now") so it picks deadlines
    // that pass the server-side rule that every task must sit inside the event
    // window and not in the past — otherwise dates like "next Friday" get
    // rejected. The actor already passed the manage check above.
    const event = await this.events.findOneForViewer(eventId, actor);
    const fmt = (d: Date | string | null | undefined) =>
      d ? new Date(d).toISOString() : 'unspecified';
    const windowInfo = `HARD DATE CONSTRAINT — read carefully:
- Today (now, ISO 8601) is ${new Date().toISOString()}.
- This event's window is ${fmt(event.start_time)} to ${fmt(event.end_time)} (ISO 8601).
- EVERY "deadline" you output MUST be >= the event start AND <= the event end, and
  must not be in the past. A date outside this window will be REJECTED.
- NEVER output a deadline later than ${fmt(event.end_time)}. If the user asks for a
  later date (e.g. "next Friday" that falls after the event end), use exactly
  ${fmt(event.end_time)} instead. If they ask for an earlier/past date, use the
  later of now and the event start.
- Spread multiple tasks across times INSIDE this window; do not exceed it.`;

    const systemPrompt = `You are an event operations assistant. The user issues a
natural-language command about an event's task list. You may CREATE new tasks,
UPDATE existing ones (reschedule, rename, re-prioritise, change status), or
REASSIGN an existing task to a different person.

Return ONLY a valid JSON array of action objects — no explanation, no markdown,
no preamble. Each object uses one of these shapes:

  { "action": "create",   "task_name": "string", "priority": "low|medium|high", "assigned_to": "name or email", "deadline": "YYYY-MM-DDTHH:mm:ss" }
  { "action": "update",   "task_ref": "existing task name or id", "task_name"?: "string", "priority"?: "low|medium|high", "deadline"?: "YYYY-MM-DDTHH:mm:ss", "status"?: "in_progress|completed|overdue" }
  { "action": "reassign", "task_ref": "existing task name or id", "assigned_to": "name or email" }

Reference existing tasks by their exact name (or id) from this list:
${taskList}

${windowInfo}

For an update, include ONLY the fields that change. To push deadlines back/forward,
emit one update per affected task with the new deadline.
If the command is too vague to act on, return instead:
{ "error": "insufficient info", "missing": ["field1", "field2"] }`;

    const aiRequest = await this.aiRequestRepo.save({
      user_id: userId,
      prompt: userMessage,
      status: 'pending',
    });

    // Forward any prior conversation turns between the system prompt and the
    // latest user message so the model can resolve references ("it", "the same
    // people") across a multi-turn clarification exchange.
    const messages = [
      { role: 'system', content: systemPrompt },
      ...(opts.history ?? []).map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: userMessage },
    ];

    try {
      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model,
          messages,
          temperature: 0.2,
          max_tokens: 2000,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          // Don't hang the request indefinitely on a slow provider.
          timeout: 30000,
        },
      );

      const data = response.data as ChatCompletionResponse;
      const raw: string = data.choices[0].message.content.trim();

      let parsed: unknown;

      try {
        parsed = JSON.parse(raw);
      } catch {
        // Don't echo the raw model output back to the client.
        throw new BadRequestException(
          'The AI returned an unexpected response. Please try rephrasing. / Trợ lý AI trả về phản hồi không hợp lệ. Vui lòng thử lại.',
        );
      }

      // A non-array object is one of: a direct answer to a question, a
      // clarification request the user must respond to, or the legacy
      // "insufficient info" rejection.
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        if (typeof obj.answer === 'string') {
          await this.aiRequestRepo.update(aiRequest.request_id, {
            response: parsed as object,
            status: 'success',
          });
          return { status: 'answered', answer: obj.answer };
        }
        if (
          obj.clarification_needed === true &&
          typeof obj.question === 'string'
        ) {
          await this.aiRequestRepo.update(aiRequest.request_id, {
            response: parsed as object,
            status: 'needs_clarification',
          });
          return {
            status: 'needs_clarification',
            request_id: aiRequest.request_id,
            question: obj.question,
          };
        }
        // else: fall through to the "rejected / insufficient info" path below.
        await this.aiRequestRepo.update(aiRequest.request_id, {
          response: parsed as object,
          status: 'rejected',
        });
        return { status: 'rejected', reason: parsed };
      }

      // Anything that isn't a JSON array of actions at this point (e.g. a bare
      // string/number) is an unexpected shape — treat as a rejection.
      if (!Array.isArray(parsed)) {
        await this.aiRequestRepo.update(aiRequest.request_id, {
          response: parsed as object,
          status: 'rejected',
        });
        return { status: 'rejected', reason: parsed };
      }

      // Drop malformed items; reject outright if nothing usable came back.
      const { actions, skipped } = this.validateActions(parsed);
      if (actions.length === 0) {
        await this.aiRequestRepo.update(aiRequest.request_id, {
          response: parsed as object,
          status: 'rejected',
        });
        return {
          status: 'rejected',
          reason: { error: 'The AI response contained no valid actions.' },
        };
      }

      // Ask mode: persist the validated plan for a later /confirm instead of
      // applying it now. Nothing is executed until the user confirms.
      if (opts.mode === 'ask') {
        const plan = this.describePlan(
          actions,
          currentTasks,
          groupIds,
          groupByTitle,
        );
        await this.aiRequestRepo.update(aiRequest.request_id, {
          response: { plan: actions, eventId, descriptions: plan } as object,
          status: 'awaiting_confirmation',
        });
        return {
          status: 'pending_confirmation',
          request_id: aiRequest.request_id,
          plan,
          unresolved: [],
          skipped,
        };
      }

      const result = await this.executeActions(
        actions,
        currentTasks,
        eventId,
        actor,
        aiRequest.request_id,
        groupIds,
        groupByTitle,
      );
      // Malformed items dropped during validation are surfaced alongside the
      // executed buckets.
      result.skipped = skipped;
      await this.aiRequestRepo.update(aiRequest.request_id, {
        response: parsed,
        status: 'success',
      });

      return { status: 'success', ...result };
    } catch (err) {
      await this.aiRequestRepo.update(aiRequest.request_id, {
        status: 'rejected',
      });
      throw err;
    }
  }

  // A pending Ask-mode plan expires after this long, so a stale preview can't be
  // applied long after the event/task state it was built against has changed.
  private static readonly CONFIRM_TTL_MS = 15 * 60 * 1000;

  // Apply a previously-previewed plan. Re-resolves task/group refs against the
  // current event state (the plan stores refs, not resolved ids), then runs the
  // same executeActions path as auto mode.
  async confirmCommand(actor: Actor, requestId: string): Promise<object> {
    const row = await this.loadPending(actor, requestId);
    const stored = row.response as { plan: AiAction[]; eventId?: string };
    const { currentTasks, groupIds, groupByTitle } =
      await this.loadEventContext(stored.eventId, actor);
    const result = await this.executeActions(
      stored.plan ?? [],
      currentTasks,
      stored.eventId,
      actor,
      requestId,
      groupIds,
      groupByTitle,
    );
    await this.aiRequestRepo.update(requestId, { status: 'success' });
    return { status: 'success', ...result };
  }

  // Discard a previously-previewed plan without applying anything.
  async cancelCommand(actor: Actor, requestId: string): Promise<object> {
    await this.loadPending(actor, requestId);
    await this.aiRequestRepo.update(requestId, { status: 'cancelled' });
    return { status: 'cancelled' };
  }

  // Load and validate a request that is awaiting confirmation: must exist, be
  // owned by the actor, still be awaiting confirmation, and not be expired.
  private async loadPending(actor: Actor, requestId: string) {
    const row = await this.aiRequestRepo.findOne({
      where: { request_id: requestId },
    });
    if (!row) {
      throw new NotFoundException(
        'AI request not found / Không tìm thấy yêu cầu AI',
      );
    }
    if (row.user_id !== actor.sub) {
      throw new ForbiddenException(
        'You do not have permission for this request / Bạn không có quyền với yêu cầu này',
      );
    }
    if (row.status !== 'awaiting_confirmation') {
      throw new BadRequestException(
        'This request is no longer awaiting confirmation / Yêu cầu này không còn chờ xác nhận',
      );
    }
    if (Date.now() - new Date(row.created_at).getTime() > AiService.CONFIRM_TTL_MS) {
      await this.aiRequestRepo.update(requestId, { status: 'cancelled' });
      throw new BadRequestException(
        'This AI plan has expired — please re-issue the command / Kế hoạch AI đã hết hạn — vui lòng yêu cầu lại',
      );
    }
    return row;
  }
}
