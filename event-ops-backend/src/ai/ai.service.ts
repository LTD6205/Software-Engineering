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
import { TasksService, UndoOp } from '../tasks/tasks.service';
import { EventsService } from '../events/events.service';
import { randomBytes } from 'crypto';
import {
  Actor,
  CommandOptions,
  ExecResult,
  AiActionKind,
  UnassignAction,
  DeleteAction,
  UndoAction,
  MergeAction,
  AddToGroupAction,
  RenameGroupAction,
  UngroupAction,
  CreateEventAction,
  UpdateEventAction,
  DeleteEventAction,
  AddEventManagerAction,
  RemoveEventManagerAction,
  CreateUserAction,
  UpdateUserAction,
  ResetPasswordAction,
  RequestReassignAction,
  AcceptReassignAction,
  RejectReassignAction,
  CancelReassignAction,
} from './ai.types';
import { isActionAllowedForRole, AI_ACTION_ROLES } from './ai.authz';
import { UsersService } from '../users/users.service';
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
  // The AI chooses each task's length: a start_time and a deadline (start before
  // deadline). start_time is optional on the wire — executeActions fills in a
  // sensible default window when the model omits it — but a real duration is what
  // keeps the task draggable on the timeline.
  start_time?: string;
  deadline: string;
  // Optional group title: new tasks sharing the same group are linked into one
  // task group after the action loop (see executeActions).
  group?: string;
}
interface UpdateAction {
  action: 'update';
  task_ref: string; // existing task id or (case-insensitive) name
  task_name?: string; // rename the task
  priority?: Priority;
  start_time?: string; // move the task's start time
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
  | UndoAction
  | MergeAction
  | AddToGroupAction
  | RenameGroupAction
  | UngroupAction
  | CreateEventAction
  | UpdateEventAction
  | DeleteEventAction
  | AddEventManagerAction
  | RemoveEventManagerAction
  | CreateUserAction
  | UpdateUserAction
  | ResetPasswordAction
  | RequestReassignAction
  | AcceptReassignAction
  | RejectReassignAction
  | CancelReassignAction;

// A task as listed for the model (and for resolving a task_ref to a real row).
// `assignees` lets the model scope commands like "reassign all of Bob's tasks"
// to the right tasks — without it, it can't tell whose tasks are whose.
interface TaskRef {
  task_id: string;
  task_name: string;
  assignees?: { user_id: string; name: string }[];
}

// The provider is any OpenAI-compatible chat-completions API — selected via
// AI_BASE_URL / AI_MODEL / AI_API_KEY in the environment, not hard-coded to one
// vendor. Switching providers is config-only (no code change). Examples:
//   DeepSeek (default): AI_BASE_URL=https://api.deepseek.com/v1            AI_MODEL=deepseek-chat
//   Gemini (free tier): AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai  AI_MODEL=gemini-2.5-flash
//   Groq:               AI_BASE_URL=https://api.groq.com/openai/v1         AI_MODEL=llama-3.3-70b-versatile
//   OpenRouter:         AI_BASE_URL=https://openrouter.ai/api/v1           AI_MODEL=<a :free model>
// AI_JSON_MODE=off disables the strict response_format request for a provider
// that rejects it (requestChatCompletion also auto-retries without it on a 4xx).
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
    private readonly users: UsersService,
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

  // Pull the JSON payload out of a model reply. Models sometimes wrap the JSON
  // in a ```json fence or add a sentence of prose despite the "JSON only"
  // instruction; strip a surrounding code fence and, failing that, slice from
  // the first opening bracket to the last closing one so JSON.parse succeeds.
  private static extractJson(raw: string): string {
    let s = raw.trim();
    const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fence) s = fence[1].trim();
    if (s[0] !== '{' && s[0] !== '[') {
      const starts = [s.indexOf('{'), s.indexOf('[')].filter((i) => i >= 0);
      const start = starts.length ? Math.min(...starts) : -1;
      const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
      if (start >= 0 && end > start) s = s.slice(start, end + 1);
    }
    return s;
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
      const eventRef =
        typeof item.event_ref === 'string' ? item.event_ref.trim() : '';
      const eventName =
        typeof item.event_name === 'string' ? item.event_name.trim() : '';
      const startTime =
        typeof item.start_time === 'string' ? item.start_time.trim() : '';
      const endTime =
        typeof item.end_time === 'string' ? item.end_time.trim() : '';
      const description =
        typeof item.description === 'string' ? item.description.trim() : '';
      const managerRef =
        typeof item.manager_ref === 'string' ? item.manager_ref.trim() : '';
      const userName = typeof item.name === 'string' ? item.name.trim() : '';
      const email = typeof item.email === 'string' ? item.email.trim() : '';
      const phone = typeof item.phone === 'string' ? item.phone.trim() : '';
      const password =
        typeof item.password === 'string' ? item.password : undefined;
      const role = typeof item.role === 'string' ? item.role.trim() : '';
      const userRef =
        typeof item.user_ref === 'string' ? item.user_ref.trim() : '';
      const newPassword =
        typeof item.new_password === 'string' ? item.new_password : '';
      const staffRef =
        typeof item.staff_ref === 'string' ? item.staff_ref.trim() : '';
      const targetManagerRef =
        typeof item.target_manager_ref === 'string'
          ? item.target_manager_ref.trim()
          : '';
      const isActive =
        typeof item.is_active === 'boolean' ? item.is_active : undefined;

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
          !startTime &&
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
          ...(startTime ? { start_time: startTime } : {}),
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
      } else if (action === 'undo') {
        actions.push({ action: 'undo' });
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
      } else if (action === 'create_event') {
        if (!eventName || !startTime || !endTime) {
          skipped++;
          continue;
        }
        actions.push({
          action: 'create_event',
          event_name: eventName,
          start_time: startTime,
          end_time: endTime,
          ...(description ? { description } : {}),
        });
      } else if (action === 'update_event') {
        if (!eventRef || (!eventName && !description)) {
          skipped++;
          continue;
        }
        actions.push({
          action: 'update_event',
          event_ref: eventRef,
          ...(eventName ? { event_name: eventName } : {}),
          ...(description ? { description } : {}),
        });
      } else if (action === 'delete_event') {
        if (!eventRef) {
          skipped++;
          continue;
        }
        actions.push({ action: 'delete_event', event_ref: eventRef });
      } else if (action === 'add_event_manager') {
        if (!eventRef || !managerRef) {
          skipped++;
          continue;
        }
        actions.push({
          action: 'add_event_manager',
          event_ref: eventRef,
          manager_ref: managerRef,
        });
      } else if (action === 'remove_event_manager') {
        if (!eventRef || !managerRef) {
          skipped++;
          continue;
        }
        actions.push({
          action: 'remove_event_manager',
          event_ref: eventRef,
          manager_ref: managerRef,
        });
      } else if (action === 'create_user') {
        if (!userName || !email) {
          skipped++;
          continue;
        }
        actions.push({
          action: 'create_user',
          name: userName,
          email,
          ...(role ? { role } : {}),
          ...(phone ? { phone } : {}),
          ...(password !== undefined ? { password } : {}),
        });
      } else if (action === 'update_user') {
        // Need a target plus at least one changeable field.
        if (!userRef || (!userName && !role && isActive === undefined)) {
          skipped++;
          continue;
        }
        actions.push({
          action: 'update_user',
          user_ref: userRef,
          ...(userName ? { name: userName } : {}),
          ...(role ? { role } : {}),
          ...(isActive !== undefined ? { is_active: isActive } : {}),
        });
      } else if (action === 'reset_password') {
        if (!userRef || !newPassword) {
          skipped++;
          continue;
        }
        actions.push({
          action: 'reset_password',
          user_ref: userRef,
          new_password: newPassword,
        });
      } else if (action === 'request_reassign') {
        if (!staffRef || !targetManagerRef) {
          skipped++;
          continue;
        }
        actions.push({
          action: 'request_reassign',
          staff_ref: staffRef,
          target_manager_ref: targetManagerRef,
        });
      } else if (
        action === 'accept_reassign' ||
        action === 'reject_reassign' ||
        action === 'cancel_reassign'
      ) {
        if (!staffRef) {
          skipped++;
          continue;
        }
        actions.push({ action, staff_ref: staffRef });
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
          ...(startTime ? { start_time: startTime } : {}),
          deadline: typeof item.deadline === 'string' ? item.deadline : '',
          ...(group ? { group } : {}),
        });
      }
    }
    // Cap a single command at 40 actions so a runaway generative reply can't fan
    // out into an unbounded batch of writes; the overflow is counted as skipped.
    const MAX_ACTIONS = 40;
    if (actions.length > MAX_ACTIONS) {
      skipped += actions.length - MAX_ACTIONS;
      actions.length = MAX_ACTIONS;
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

  // Resolve a model-supplied event_ref to a real event id the actor can see: an
  // exact id match first, else a case-insensitive event-name match. When no ref
  // is given, fall back to the request's default event. Null when no match.
  private resolveEventRef(
    ref: string | undefined,
    events: { event_id: string; event_name: string }[],
    defaultEventId?: string,
  ): string | null {
    if (!ref) return defaultEventId ?? null;
    const needle = ref.trim().toLowerCase();
    return (
      events.find((e) => e.event_id.toLowerCase() === needle)?.event_id ??
      events.find((e) => e.event_name.trim().toLowerCase() === needle)
        ?.event_id ??
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

  // A non-trivial fallback password for an AI-created user when the command did
  // not supply one. Deliberately avoids Math.random: a Date.now()-derived suffix
  // keeps it reproducible-by-time and easy to reason about in tests/logs while
  // still satisfying the policy (mixed case, digit, symbol, length). The new
  // account is expected to have its password reset on first use.
  private tempPassword(): string {
    // Cryptographically random so the initial password is unguessable
    // regardless of creation time; base64url + a fixed suffix satisfies any
    // complexity policy. The account is expected to reset it on first use.
    return `Tmp_${randomBytes(16).toString('base64url')}A1`;
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

  // Resolve a user reference by name or email REGARDLESS of active state. Used
  // for admin account-management actions (update_user/reset_password) so an
  // admin can target a deactivated account — e.g. "reactivate Bob" — which the
  // active-only resolveAssignee above could never match.
  private async resolveUserRef(ref?: string): Promise<User | null> {
    const needle = ref?.trim();
    if (!needle) return null;
    return this.userRepo.findOne({
      where: [{ email: needle }, { name: needle }],
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
      assignees?: { user_id: string; name: string }[];
    }>;
    const currentTasks: TaskRef[] = rows.map((t) => ({
      task_id: t.task_id,
      task_name: t.task_name,
      assignees: (t.assignees ?? []).map((a) => ({
        user_id: a.user_id,
        name: a.name,
      })),
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
        case 'undo':
          return {
            kind: 'undo',
            description: 'Undo the most recent change in this event',
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

  // Build the role-scoped context block fed into the system prompt: the actor's
  // role + current date-time, up to 20 viewable events (nearest deadline first,
  // with an overflow note), the current event's tasks (when eventId is set), and
  // the assignable roster (a manager's own active staff). This powers both reads
  // (answer) and reference resolution / assignment for writes.
  private async buildContextBlock(
    actor: Actor,
    eventId: string | undefined,
    currentTasks: TaskRef[],
    viewableEvents: Array<{
      event_id: string;
      event_name: string;
      start_time?: string | Date | null;
      end_time?: string | Date | null;
      task_count?: number;
      completed_count?: number;
    }>,
  ): Promise<string> {
    const fmt = (d: Date | string | null | undefined) =>
      d ? new Date(d).toISOString() : 'unspecified';
    const lines: string[] = [];
    lines.push(`Actor role: ${actor.role}. Current date-time: ${new Date().toISOString()}.`);

    // Up to 20 viewable events, nearest end_time first; note any overflow.
    const sortedEvents = [...viewableEvents].sort((a, b) => {
      const ax = a.end_time ? new Date(a.end_time).getTime() : Infinity;
      const bx = b.end_time ? new Date(b.end_time).getTime() : Infinity;
      return ax - bx;
    });
    const shownEvents = sortedEvents.slice(0, 20);
    if (shownEvents.length) {
      lines.push('Events you can see (nearest deadline first):');
      for (const e of shownEvents) {
        const counts =
          e.task_count !== undefined
            ? ` — ${e.completed_count ?? 0}/${e.task_count} tasks done`
            : '';
        lines.push(
          `- "${e.event_name}" (id ${e.event_id}), ${fmt(e.start_time)} to ${fmt(e.end_time)}${counts}`,
        );
      }
      if (sortedEvents.length > 20) {
        lines.push(
          `…and ${sortedEvents.length - 20} more events not listed (showing the 20 nearest).`,
        );
      }
    } else {
      lines.push('Events you can see: (none)');
    }

    // The current event's tasks (resolvable refs for update/reassign/etc.).
    if (eventId) {
      if (currentTasks.length) {
        lines.push("Current event's tasks (reference these by exact name or id):");
        for (const t of currentTasks) {
          const who = t.assignees?.length
            ? t.assignees.map((a) => a.name).join(', ')
            : 'unassigned';
          lines.push(
            `- "${t.task_name}" (id ${t.task_id}) — assigned to: ${who}`,
          );
        }
      } else {
        lines.push("Current event's tasks: (none yet)");
      }
    }

    // The assignable roster. For a manager this is their own active staff; for
    // organizer/admin we keep it simple (best-effort empty list — see spec
    // Limitations) since their assignable set spans whole teams.
    let roster: Array<{ name?: string; email?: string }> = [];
    if (actor.role === 'manager') {
      roster = (await this.userRepo.find({
        where: { manager_id: actor.sub, is_active: true },
      })) as Array<{ name?: string; email?: string }>;
    }
    const shownRoster = roster.slice(0, 50);
    if (shownRoster.length) {
      lines.push('People you can assign tasks to:');
      for (const u of shownRoster) {
        lines.push(`- ${u.name ?? ''}${u.email ? ` <${u.email}>` : ''}`);
      }
    } else {
      lines.push('People you can assign tasks to: (none on record)');
    }

    return lines.join('\n');
  }

  // One-line JSON shape per action kind, advertised to the model. Only the
  // shapes whose role allow-list includes the actor are emitted (so the prompt
  // never describes an action the role cannot perform).
  private static readonly ACTION_SHAPES: Record<AiActionKind, string> = {
    create:
      '{ "action": "create", "task_name": "string", "priority": "low|medium|high", "assigned_to": "name or email", "start_time": "YYYY-MM-DDTHH:mm:ss", "deadline": "YYYY-MM-DDTHH:mm:ss", "group"?: "group title" }',
    update:
      '{ "action": "update", "task_ref": "task name or id", "task_name"?: "string (rename)", "priority"?: "low|medium|high", "start_time"?: "YYYY-MM-DDTHH:mm:ss", "deadline"?: "YYYY-MM-DDTHH:mm:ss", "status"?: "in_progress|completed|overdue" }',
    reassign:
      '{ "action": "reassign", "task_ref": "task name or id", "assigned_to": "name or email" }',
    unassign: '{ "action": "unassign", "task_ref": "task name or id" }',
    delete: '{ "action": "delete", "task_ref": "task name or id" }',
    undo: '{ "action": "undo" }',
    merge:
      '{ "action": "merge", "task_ref": "source task", "target_ref": "target task" }',
    add_to_group:
      '{ "action": "add_to_group", "group_ref": "group title or id", "task_ref": "task name or id" }',
    rename_group:
      '{ "action": "rename_group", "group_ref": "group title or id", "title": "new title" }',
    ungroup: '{ "action": "ungroup", "task_ref": "task name or id" }',
    create_event:
      '{ "action": "create_event", "event_name": "string", "start_time": "YYYY-MM-DDTHH:mm:ss", "end_time": "YYYY-MM-DDTHH:mm:ss", "description"?: "string" }',
    update_event:
      '{ "action": "update_event", "event_ref": "event name or id", "event_name"?: "string", "description"?: "string" }',
    delete_event:
      '{ "action": "delete_event", "event_ref": "event name or id" }',
    add_event_manager:
      '{ "action": "add_event_manager", "event_ref": "event name or id", "manager_ref": "manager name or email" }',
    remove_event_manager:
      '{ "action": "remove_event_manager", "event_ref": "event name or id", "manager_ref": "manager name or email" }',
    create_user:
      '{ "action": "create_user", "name": "string", "email": "string", "role"?: "staff|manager|organizer", "phone"?: "string" }',
    update_user:
      '{ "action": "update_user", "user_ref": "name or email", "name"?: "string", "role"?: "string", "is_active"?: true|false }',
    reset_password:
      '{ "action": "reset_password", "user_ref": "name or email", "new_password": "string" }',
    request_reassign:
      '{ "action": "request_reassign", "staff_ref": "name or email", "target_manager_ref": "manager name or email" }',
    accept_reassign: '{ "action": "accept_reassign", "staff_ref": "name or email" }',
    reject_reassign: '{ "action": "reject_reassign", "staff_ref": "name or email" }',
    cancel_reassign: '{ "action": "cancel_reassign", "staff_ref": "name or email" }',
  };

  // The allowed action shapes for a role, one per line, derived from the same
  // role allow-list used by the hard gate.
  private buildActionCatalog(role: string): string {
    const shapes = (
      Object.keys(AI_ACTION_ROLES) as AiActionKind[]
    ).filter((kind) => isActionAllowedForRole(role, kind));
    if (!shapes.length) {
      return '  (your role has no write actions; you may only answer questions)';
    }
    return shapes
      .map((kind) => `  ${AiService.ACTION_SHAPES[kind]}`)
      .join('\n');
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
    viewableEvents: { event_id: string; event_name: string }[],
  ): Promise<ExecResult> {
    const res = this.emptyResult();
    // New tasks tagged with a `group` title, collected as creates land and
    // linked into one task group after the loop.
    const createdGroups: { taskId: string; title: string }[] = [];
    // Collect every task change this command makes so the WHOLE command is one
    // undoable operation ("create 10 tasks → undo → empty"; "delete a bunch →
    // undo → restored"). Recorded once after the loop.
    const undoOp = this.tasksService.newUndoOp();
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
        viewableEvents,
        undoOp,
      );
    }
    // Link newly-created tasks that share a group title. Reuse an existing event
    // group with that title if present, else chain members via merge (the first
    // pair creates the group; subsequent members add to it).
    // Keep the original-case title (the map key is lower-cased for matching) so
    // the group is labelled with exactly what the AI named it.
    const byTitle = new Map<string, { ids: string[]; label: string }>();
    for (const g of createdGroups) {
      const key = g.title.toLowerCase();
      const entry = byTitle.get(key);
      if (entry) entry.ids.push(g.taskId);
      else byTitle.set(key, { ids: [g.taskId], label: g.title });
    }
    for (const [title, { ids: taskIds, label }] of byTitle) {
      const existing = groupByTitle.get(title);
      try {
        if (existing) {
          // Reuse the existing event group (keep its current title).
          for (const id of taskIds)
            await this.tasksService.addToGroup(existing, id, actor);
          res.groups_changed.push({
            action: 'add_to_group',
            group_id: existing,
            title: label,
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
          // merge() creates the group with a blank title; apply the name the AI
          // chose so it isn't shown as "Untitled group".
          if (gid && label)
            await this.tasksService.renameGroup(gid, label, actor);
          res.groups_changed.push({
            action: 'merge',
            group_id: gid,
            title: label,
          });
        }
      } catch (e) {
        res.rejected.push({ ref: label, reason: this.reason(e) });
      }
    }
    // Record the whole command as ONE undoable operation (one undo reverses it).
    if (defaultEventId) {
      await this.tasksService.recordOp(defaultEventId, undoOp, undefined, actor.sub);
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
    viewableEvents: { event_id: string; event_name: string }[],
    undoOp: UndoOp,
  ): Promise<void> {
    switch (item.action) {
      case 'create': {
        // event_ref resolution arrives in Phase 4; for now every create lands
        // in the request event.
        const eventId = defaultEventId;
        let task: { task_id: string; task_name: string };
        // Every AI task gets a real [start_time, deadline] window so it renders as
        // a draggable block. A task with only a deadline collapses to zero width on
        // the timeline, and the first drag (start === deadline) trips the
        // tasks_time_check (deadline > start_time) DB constraint.
        //
        // The window is also slid forward so it never starts in the past. When a
        // plan is for "today", the model often spreads tasks across the day and
        // the ones earlier than the current clock time would otherwise be rejected
        // by assertNotInPast — so only one task survives. Instead, preserve each
        // task's intended length and shift it to begin at "now".
        const HOUR = 60 * 60 * 1000;
        const now = Date.now();
        let deadline = AiService.parseDeadline(item.deadline);
        let startTime = AiService.parseDeadline(item.start_time);
        if (deadline) {
          // The task's intended length: the model's [start, deadline] span when
          // both are given and valid, otherwise a one-hour default.
          const span =
            startTime && startTime.getTime() < deadline.getTime()
              ? deadline.getTime() - startTime.getTime()
              : HOUR;
          if (deadline.getTime() <= now) {
            // Whole window is in the past — slide it forward to start now,
            // keeping its length, so the task is created rather than rejected.
            startTime = new Date(now);
            deadline = new Date(now + span);
          } else if (
            !startTime ||
            startTime.getTime() >= deadline.getTime() ||
            startTime.getTime() < now
          ) {
            // Deadline is in the future, but the start is missing, after the
            // deadline, or in the past — pull it to the later of (deadline - span)
            // and now, so the lead-in never sits in the past.
            startTime = new Date(Math.max(deadline.getTime() - span, now));
          }
        }
        try {
          task = await this.tasksService.create(
            {
              event_id: eventId,
              task_name: item.task_name,
              priority_label: item.priority,
              priority_score: AiService.priorityScore(item.priority),
              priority_source: 'ai',
              ...(startTime ? { start_time: startTime } : {}),
              deadline,
            },
            actor,
            { undoOp },
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
        if (item.start_time !== undefined) {
          const s = AiService.parseDeadline(item.start_time);
          if (s) patch.start_time = s;
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
            { undoOp },
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
          await this.tasksService.remove(t.task_id, actor, { undoOp });
          res.tasks_deleted.push({
            task_id: t.task_id,
            task_name: t.task_name,
          });
        } catch (e) {
          res.rejected.push({ ref: item.task_ref, reason: this.reason(e) });
        }
        return;
      }

      case 'undo': {
        if (!defaultEventId) {
          res.rejected.push({
            ref: 'undo',
            reason: 'No event in context to undo',
          });
          return;
        }
        try {
          const r = (await this.tasksService.undoLastChange(
            defaultEventId,
            actor,
          )) as { undone?: unknown };
          res.tasks_updated.push({ undone: r.undone });
        } catch (e) {
          res.rejected.push({ ref: 'undo', reason: this.reason(e) });
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

      case 'create_event': {
        // Validate the model's dates are parseable before persisting, mirroring
        // the task path's parseDeadline — an Invalid Date would slip past
        // EventsService.assertValidDateRange (NaN comparisons are false).
        const start = AiService.parseDeadline(item.start_time);
        const end = AiService.parseDeadline(item.end_time);
        if (!start || !end) {
          res.rejected.push({
            ref: item.event_name,
            reason: 'Event start/end date was missing or unparseable',
          });
          return;
        }
        // created_by always comes from the verified JWT, never the model output.
        try {
          const ev = await this.events.create(
            {
              event_name: item.event_name,
              description: item.description,
              start_time: start,
              end_time: end,
              created_by: actor.sub,
            },
            [],
          );
          res.events_changed.push({
            action: 'create_event',
            event_id: (ev as { event_id: string }).event_id,
            event_name: (ev as { event_name: string }).event_name,
          });
        } catch (e) {
          res.rejected.push({ ref: item.event_name, reason: this.reason(e) });
        }
        return;
      }

      case 'update_event': {
        const id = this.resolveEventRef(
          item.event_ref,
          viewableEvents,
          defaultEventId,
        );
        if (!id) {
          res.unresolved.push(item.event_ref);
          return;
        }
        try {
          await this.events.assertCanManageEvent(actor, id);
          const ev = await this.events.update(id, {
            event_name: item.event_name,
            description: item.description,
          });
          res.events_changed.push({
            action: 'update_event',
            event_id: id,
            event_name: (ev as { event_name?: string }).event_name,
          });
        } catch (e) {
          res.rejected.push({ ref: item.event_ref, reason: this.reason(e) });
        }
        return;
      }

      case 'delete_event': {
        const id = this.resolveEventRef(
          item.event_ref,
          viewableEvents,
          defaultEventId,
        );
        if (!id) {
          res.unresolved.push(item.event_ref);
          return;
        }
        try {
          await this.events.assertCanManageEvent(actor, id);
          await this.events.remove(id);
          res.events_changed.push({ action: 'delete_event', event_id: id });
        } catch (e) {
          res.rejected.push({ ref: item.event_ref, reason: this.reason(e) });
        }
        return;
      }

      case 'add_event_manager': {
        const id = this.resolveEventRef(
          item.event_ref,
          viewableEvents,
          defaultEventId,
        );
        // The reference must resolve to an active user who is actually a manager
        // (only managers can be added to an event's manager roster).
        const mgr = await this.resolveAssignee(item.manager_ref);
        if (!id || !mgr || mgr.role !== 'manager') {
          res.unresolved.push(!id ? item.event_ref : item.manager_ref);
          return;
        }
        try {
          await this.events.assertCanManageEvent(actor, id);
          await this.events.addManager(id, mgr.user_id, true);
          res.events_changed.push({
            action: 'add_event_manager',
            event_id: id,
          });
        } catch (e) {
          res.rejected.push({ ref: item.manager_ref, reason: this.reason(e) });
        }
        return;
      }

      case 'remove_event_manager': {
        const id = this.resolveEventRef(
          item.event_ref,
          viewableEvents,
          defaultEventId,
        );
        const mgr = await this.resolveAssignee(item.manager_ref);
        if (!id || !mgr || mgr.role !== 'manager') {
          res.unresolved.push(!id ? item.event_ref : item.manager_ref);
          return;
        }
        try {
          await this.events.assertCanManageEvent(actor, id);
          await this.events.removeManager(id, mgr.user_id);
          res.events_changed.push({
            action: 'remove_event_manager',
            event_id: id,
          });
        } catch (e) {
          res.rejected.push({ ref: item.manager_ref, reason: this.reason(e) });
        }
        return;
      }

      case 'create_user': {
        // Replicate UsersController.assertCanAssignRole: the UsersService does
        // NOT block a manager from creating a non-staff role — the controller
        // does — so the AI must enforce it before calling create.
        if (actor.role !== 'admin' && item.role && item.role !== 'staff') {
          res.rejected.push({
            ref: item.email,
            reason: 'Only an admin can assign a non-staff role',
          });
          return;
        }
        try {
          const u = await this.users.create(
            {
              name: item.name,
              email: item.email,
              phone: item.phone ?? '',
              password: item.password ?? this.tempPassword(),
              role: item.role,
            },
            actor,
          );
          res.users_changed.push({
            action: 'create_user',
            user_id: (u as { user_id: string }).user_id,
            summary: `Created ${item.name}`,
          });
        } catch (e) {
          res.rejected.push({ ref: item.email, reason: this.reason(e) });
        }
        return;
      }

      case 'update_user': {
        // Resolve regardless of active state so an admin can reactivate a
        // deactivated account ("reactivate Bob").
        const target = await this.resolveUserRef(item.user_ref);
        if (!target) {
          res.unresolved.push(item.user_ref);
          return;
        }
        // Activating/deactivating an account is admin-only (mirrors the
        // controller's gate inside PUT /users/:id; the service does not enforce
        // it on is_active alone).
        if (item.is_active !== undefined && actor.role !== 'admin') {
          res.rejected.push({
            ref: item.user_ref,
            reason: 'Only an admin can activate or deactivate accounts',
          });
          return;
        }
        try {
          await this.users.update(
            target.user_id,
            {
              name: item.name,
              role: item.role,
              is_active: item.is_active,
            },
            actor,
          );
          res.users_changed.push({
            action: 'update_user',
            user_id: target.user_id,
            summary: `Updated ${target.name}`,
          });
        } catch (e) {
          res.rejected.push({ ref: item.user_ref, reason: this.reason(e) });
        }
        return;
      }

      case 'reset_password': {
        // Defense-in-depth: reset_password is already admin-only via the central
        // role gate in executeActions, but re-assert here so the case is safe in
        // isolation (mirrors the inline guards on create_user/update_user).
        if (actor.role !== 'admin') {
          res.rejected.push({
            ref: item.user_ref,
            reason:
              'Only an admin can reset a password / Chỉ quản trị viên mới có thể đặt lại mật khẩu',
          });
          return;
        }
        // Resolve regardless of active state (a deactivated account may still
        // need a password reset before reactivation).
        const target = await this.resolveUserRef(item.user_ref);
        if (!target) {
          res.unresolved.push(item.user_ref);
          return;
        }
        try {
          await this.users.update(
            target.user_id,
            { password: item.new_password },
            actor,
          );
          res.users_changed.push({
            action: 'reset_password',
            user_id: target.user_id,
            summary: `Reset password for ${target.name}`,
          });
        } catch (e) {
          res.rejected.push({ ref: item.user_ref, reason: this.reason(e) });
        }
        return;
      }

      case 'request_reassign': {
        const staff = await this.resolveAssignee(item.staff_ref);
        const mgr = await this.resolveAssignee(item.target_manager_ref);
        if (!staff || !mgr) {
          res.unresolved.push(
            !staff ? item.staff_ref : item.target_manager_ref,
          );
          return;
        }
        try {
          await this.users.requestReassign(staff.user_id, mgr.user_id, actor);
          res.users_changed.push({
            action: 'request_reassign',
            user_id: staff.user_id,
            summary: `Requested move of ${staff.name}`,
          });
        } catch (e) {
          res.rejected.push({ ref: item.staff_ref, reason: this.reason(e) });
        }
        return;
      }

      case 'accept_reassign':
      case 'reject_reassign':
      case 'cancel_reassign': {
        const staff = await this.resolveAssignee(item.staff_ref);
        if (!staff) {
          res.unresolved.push(item.staff_ref);
          return;
        }
        try {
          const fn =
            item.action === 'accept_reassign'
              ? this.users.acceptReassign
              : item.action === 'reject_reassign'
                ? this.users.rejectReassign
                : this.users.cancelReassign;
          await fn.call(this.users, staff.user_id, actor);
          res.users_changed.push({
            action: item.action,
            user_id: staff.user_id,
            summary: `${item.action} for ${staff.name}`,
          });
        } catch (e) {
          res.rejected.push({ ref: item.staff_ref, reason: this.reason(e) });
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
    // When a specific event is in scope, the actor must be able to manage it
    // (checked before we spend an external AI call). Cross-event commands
    // (e.g. creating an event, or a general question) carry no eventId; their
    // authorization is enforced per-action by the role gate + services, so we
    // must NOT run an event-scoped check with an empty id here.
    if (eventId) {
      await this.events.assertCanManageEvent(actor, eventId);
    }
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
    // The events the actor can see, used to resolve event_ref for event actions
    // (create/update/delete event, add/remove manager) — and, later, reads.
    const viewableEvents = (await this.events.findForViewer(actor)) as Array<{
      event_id: string;
      event_name: string;
      start_time: string;
      end_time: string;
    }>;
    // Role-scoped context block: actor role + now, viewable events, the current
    // event's tasks, and the assignable roster. Powers reads (answer) and
    // reference resolution / assignment for writes.
    const contextBlock = await this.buildContextBlock(
      actor,
      eventId || undefined,
      currentTasks,
      viewableEvents,
    );

    // Tell the model the event's date window (and "now") so it picks deadlines
    // that pass the server-side rule that every task must sit inside the event
    // window and not in the past — otherwise dates like "next Friday" get
    // rejected. Only meaningful when a specific event is in scope. The actor
    // already passed the view/manage check above.
    const fmt = (d: Date | string | null | undefined) =>
      d ? new Date(d).toISOString() : 'unspecified';
    let windowInfo = `DATE GUIDANCE:
- Today (now, ISO 8601) is ${new Date().toISOString()}.
- Never output a task start_time or deadline in the past.
- When the user prompt, schedule from the CURRENT TIME onward: lay the tasks out one after another AFTER now, never starting in the morning of a day that is already partly over.
- Give every task "create" BOTH a "start_time" and a "deadline", with the start_time strictly before the deadline, so each task has a real duration (about an hour if unsure).
- For "create_event": the "end_time" MUST be at least one day from now; the "start_time" may be earlier (even in the past).`;
    if (eventId) {
      const event = await this.events.findOneForViewer(eventId, actor);
      windowInfo = `HARD DATE CONSTRAINT — read carefully:
- Today (now, ISO 8601) is ${new Date().toISOString()}.
- This event's window is ${fmt(event.start_time)} to ${fmt(event.end_time)} (ISO 8601).
- EVERY "deadline" you output MUST be >= the event start AND <= the event end, and
  must not be in the past. A date outside this window will be REJECTED.
- NEVER output a deadline later than ${fmt(event.end_time)}. If the user asks for a
  later date (e.g. "next Friday" that falls after the event end), use exactly
  ${fmt(event.end_time)} instead. If they ask for an earlier/past date, use the
  later of now and the event start.
- Give every task BOTH a "start_time" and a "deadline": both MUST sit inside this
  window, with the start_time strictly BEFORE the deadline (a sensible duration,
  e.g. about an hour), so the task has a real length on the timeline.
- Spread multiple tasks across times INSIDE this window; do not exceed it.
- When the user says "today" (or a time of day that has already passed), start
  from the CURRENT TIME and lay the tasks out one after another AFTER now — do not
  schedule them in the morning of a day that is already partly over.`;
    }

    // The advertised action catalog is filtered to the actor's role so the model
    // only ever sees shapes it is permitted to use (the hard gate still re-checks
    // each action in executeActions).
    const actionCatalog = this.buildActionCatalog(actor.role);

    const systemPrompt = `You are an event operations partner for the role "${actor.role}".
The user issues a natural-language command or question about events, tasks,
groups, people, and (for some roles) accounts. Use the context below to answer
questions, resolve references, and plan work.

CONTEXT (everything you can see right now):
${contextBlock}

${windowInfo}

You reply with a SINGLE JSON OBJECT — and NOTHING else (no markdown, no prose,
no preamble). It MUST be exactly one of these three json shapes:

1) ACTIONS to perform — "kind":"actions" with an "actions" array of action
   objects: { "kind": "actions", "actions": [ <action>, <action>, ... ] }
   Allowed action shapes for the "actions" array (for your role):
${actionCatalog}

2) A direct ANSWER to a question, answered ONLY from the context above:
  { "kind": "answer", "answer": "..." }

3) A CLARIFICATION request, ONLY when truly blocked and you cannot infer a sane default:
  { "kind": "clarification", "question": "..." }

RULES:
- Reference existing tasks/events/groups/people by their exact name (or id) from the context.
- For an "update", include ONLY the fields that change. To shift deadlines, emit one update per affected task.
- To undo the most recent change in the current event (an edit or a deletion), emit { "action": "undo" }. Use this for "undo", "revert that", "undo the last change", "put it back".
- SCOPED BULK CHANGES: When a command targets "all of <person>'s tasks" (reassign, reschedule, etc.), act ONLY on tasks whose "assigned to:" in the context lists that person. Emit one action per such task by its exact name, and DO NOT touch tasks assigned to anyone else. If no task is assigned to that person, make no changes and say so (an answer) instead of guessing.
- ANTI-NAG: Prefer sensible defaults over asking. Ask for clarification ONLY when a command is genuinely ambiguous or missing an essential detail you cannot reasonably infer. A high-level/generative goal (e.g. "plan a birthday party", "set up everything for the gala") MUST NOT ask a question — decompose it instead.
- GENERATIVE PLANNING: For a high-level goal, decompose it into a COMPLETE checklist of "create" actions, each with a "start_time" and a "deadline" (start before deadline, a sensible duration) INSIDE the event window, group related tasks via a "group" title, and spread "assigned_to" across the people listed in the context.
- If a command is too vague to act on and a clarification would not help, return: { "error": "insufficient info", "missing": ["field1", "field2"] }.`;

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
      const raw: string = (
        await this.requestChatCompletion(baseUrl, model, apiKey, messages)
      ).trim();

      let parsed: unknown;

      try {
        parsed = JSON.parse(AiService.extractJson(raw));
      } catch {
        // Don't echo the raw model output back to the client.
        throw new BadRequestException(
          'The AI returned an unexpected response. Please try rephrasing. / Trợ lý AI trả về phản hồi không hợp lệ. Vui lòng thử lại.',
        );
      }

      // Preferred protocol: a single wrapped object { "kind": "...", ... } so the
      // response is always a JSON object (what response_format json_object
      // requires — a top-level array isn't allowed). Unwrap it into the shapes the
      // routing below already handles. A bare top-level array and the legacy
      // { answer } / { clarification_needed } objects still work as a fallback
      // (older prompts, or providers that ignore response_format).
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const wrapped = parsed as Record<string, unknown>;
        if (Array.isArray(wrapped.actions)) {
          parsed = wrapped.actions;
        } else if (
          wrapped.kind === 'clarification' &&
          typeof wrapped.question === 'string'
        ) {
          parsed = {
            clarification_needed: true,
            question: wrapped.question,
          };
        }
        // { kind: 'answer', answer } needs no change — the answer branch below
        // already keys off a string `answer` field.
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
          // Stamp creation time as epoch-ms in the JSONB we control, so the TTL
          // check at confirm time is immune to the timezone skew of the
          // `timestamp without time zone` created_at column (node-pg parses it
          // in the process's local zone, which need not match the DB's).
          response: {
            plan: actions,
            eventId,
            descriptions: plan,
            createdAtMs: Date.now(),
          } as object,
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
        viewableEvents,
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

  // One OpenAI-compatible chat-completion call, resilient to switching providers
  // (DeepSeek ↔ Gemini ↔ Groq ↔ OpenRouter, via AI_BASE_URL/AI_MODEL/AI_API_KEY).
  // We ask for a strict JSON object with response_format, but providers/models
  // vary in whether they accept that field — so if the first attempt fails with a
  // client error (4xx), we retry once WITHOUT response_format. The wrapped-object
  // prompt plus the markdown-fence-stripping parser still yield usable JSON, so a
  // model switch "just works". Set AI_JSON_MODE=off to skip response_format
  // entirely for a provider you know rejects it.
  private async requestChatCompletion(
    baseUrl: string,
    model: string,
    apiKey: string,
    messages: { role: string; content: string }[],
  ): Promise<string> {
    const url = `${baseUrl}/chat/completions`;
    const base = { model, messages, temperature: 0.2, max_tokens: 2000 };
    const options = {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      // Don't hang the request indefinitely on a slow provider.
      timeout: 30000,
    };
    const jsonMode =
      (this.config.get<string>('AI_JSON_MODE') ?? 'on').toLowerCase() !== 'off';
    const send = async (body: object): Promise<string> => {
      const res = await axios.post(url, body, options);
      return (res.data as ChatCompletionResponse).choices[0].message.content;
    };

    if (!jsonMode) return send(base);
    try {
      return await send({ ...base, response_format: { type: 'json_object' } });
    } catch (e) {
      const status = (e as { response?: { status?: number } } | undefined)
        ?.response?.status;
      // 400/422 most likely means this provider/model doesn't accept
      // response_format — retry once without it rather than failing the switch.
      // (Auth/rate-limit/5xx errors are re-thrown; retrying those is pointless.)
      if (status === 400 || status === 422) {
        return send(base);
      }
      throw e;
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
    const viewableEvents = (await this.events.findForViewer(actor)) as Array<{
      event_id: string;
      event_name: string;
    }>;
    const result = await this.executeActions(
      stored.plan ?? [],
      currentTasks,
      stored.eventId,
      actor,
      requestId,
      groupIds,
      groupByTitle,
      viewableEvents,
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
    // Prefer the epoch-ms stamp written into the plan JSON (timezone-safe);
    // fall back to the DB created_at only if it's somehow absent.
    const createdMs =
      (row.response as { createdAtMs?: number } | null)?.createdAtMs ??
      new Date(row.created_at).getTime();
    if (Date.now() - createdMs > AiService.CONFIRM_TTL_MS) {
      await this.aiRequestRepo.update(requestId, { status: 'cancelled' });
      throw new BadRequestException(
        'This AI plan has expired — please re-issue the command / Kế hoạch AI đã hết hạn — vui lòng yêu cầu lại',
      );
    }
    return row;
  }
}
