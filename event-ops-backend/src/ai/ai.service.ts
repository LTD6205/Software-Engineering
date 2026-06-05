import {
  Injectable,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiRequest } from '../entities/ai-request.entity';
import { AiTaskMap } from '../entities/ai-task-map.entity';
import { User } from '../entities/user.entity';
import { TasksService } from '../tasks/tasks.service';
import { EventsService } from '../events/events.service';
import { Actor, CommandOptions } from './ai.types';
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
type AiAction = CreateAction | UpdateAction | ReassignAction;

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
      } else {
        // create (default)
        if (!name) {
          skipped++;
          continue;
        }
        actions.push({
          action: 'create',
          task_name: name,
          priority: AiService.normalisePriority(item.priority),
          assigned_to: assignedTo,
          deadline: typeof item.deadline === 'string' ? item.deadline : '',
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
    // for update/reassign (not just create new ones). Viewer-scoped read; the
    // actor already passed the manage check above.
    const currentTasks: TaskRef[] = (
      (await this.tasksService.findAllByEvent(eventId, actor)) as TaskRef[]
    ).map((t) => ({ task_id: t.task_id, task_name: t.task_name }));
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

    try {
      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
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

      // Not an array means AI returned an error object
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

      const createdTasks: object[] = [];
      const updatedTasks: object[] = [];
      const reassignedTasks: object[] = [];
      // task_ref values the model named but we couldn't match to a real task.
      const unresolved: string[] = [];
      // Tasks the server refused (e.g. a deadline outside the event window or in
      // the past). Recorded per-task so one bad task doesn't abort the command.
      const rejected: { task_name: string; reason: string }[] = [];

      for (const item of actions) {
        if (item.action === 'create') {
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
            rejected.push({
              task_name: item.task_name,
              reason:
                e instanceof HttpException
                  ? (e.getResponse() as { message?: string }).message ||
                    e.message
                  : 'Could not be created',
            });
            continue;
          }
          // Assign if the AI named a matchable user. The assignment obeys the
          // same rules as a manual one (actor manages the event and, for a plain
          // manager, the assignee is their own staff), so an out-of-team
          // suggestion is skipped rather than failing the whole command.
          await this.tryAssign(task.task_id, item.assigned_to, actor);
          await this.aiTaskMapRepo.save({
            request_id: aiRequest.request_id,
            task_id: task.task_id,
          });
          // Let later update/reassign actions reference this new task by name.
          currentTasks.push({
            task_id: task.task_id,
            task_name: task.task_name,
          });
          createdTasks.push({ ...task });
          continue;
        }

        // update / reassign both target an existing task.
        const target = this.resolveTaskRef(item.task_ref, currentTasks);
        if (!target) {
          unresolved.push(item.task_ref);
          continue;
        }

        if (item.action === 'update') {
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
          if (Object.keys(patch).length === 0) continue;
          try {
            const task = await this.tasksService.update(
              target.task_id,
              patch,
              actor,
            );
            await this.aiTaskMapRepo.save({
              request_id: aiRequest.request_id,
              task_id: target.task_id,
            });
            updatedTasks.push({ ...task });
          } catch {
            // A disallowed edit (e.g. moving a deadline into the past) is skipped
            // rather than failing the whole command.
            unresolved.push(item.task_ref);
          }
        } else {
          // reassign — replace the task's assignee set with the matched user.
          const assignee = await this.resolveAssignee(item.assigned_to);
          if (!assignee) {
            unresolved.push(item.assigned_to);
            continue;
          }
          try {
            await this.tasksService.setAssignees(
              target.task_id,
              [assignee.user_id],
              actor,
            );
            await this.aiTaskMapRepo.save({
              request_id: aiRequest.request_id,
              task_id: target.task_id,
            });
            reassignedTasks.push({
              task_id: target.task_id,
              task_name: target.task_name,
              assigned_to: assignee.user_id,
            });
          } catch {
            unresolved.push(item.task_ref);
          }
        }
      }

      await this.aiRequestRepo.update(aiRequest.request_id, {
        response: parsed,
        status: 'success',
      });

      return {
        status: 'success',
        tasks_created: createdTasks,
        tasks_updated: updatedTasks,
        tasks_reassigned: reassignedTasks,
        unresolved,
        rejected,
        skipped,
      };
    } catch (err) {
      await this.aiRequestRepo.update(aiRequest.request_id, {
        status: 'rejected',
      });
      throw err;
    }
  }

  async confirmCommand(_actor: Actor, _requestId: string): Promise<object> {
    throw new Error('not implemented'); // Phase 3
  }

  async cancelCommand(_actor: Actor, _requestId: string): Promise<object> {
    throw new Error('not implemented'); // Phase 3
  }
}
