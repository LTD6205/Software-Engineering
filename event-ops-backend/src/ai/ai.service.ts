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
import axios from 'axios';

interface Actor {
  sub: string;
  role: string;
}

interface ParsedTask {
  task_name: string;
  priority: 'low' | 'medium' | 'high';
  assigned_to: string;
  deadline: string;
}

interface DeepSeekResponse {
  choices: { message: { content: string } }[];
}

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
    const calls = (this.recentCalls.get(userId) ?? []).filter((t) => t > cutoff);
    if (calls.length >= AiService.RATE_LIMIT) {
      throw new HttpException(
        'Too many AI requests — please wait a moment. / Quá nhiều yêu cầu AI — vui lòng đợi một lát.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    calls.push(now);
    this.recentCalls.set(userId, calls);
  }

  // Runtime validation of the model's JSON array: keep only items with a real
  // task name, normalise an unknown priority to 'medium', and report how many
  // malformed items were dropped (the compile-time ParsedTask type is no
  // guarantee for arbitrary model output).
  private validateItems(parsed: unknown[]): {
    valid: ParsedTask[];
    skipped: number;
  } {
    const valid: ParsedTask[] = [];
    let skipped = 0;
    for (const raw of parsed) {
      const item = (raw ?? {}) as Partial<ParsedTask>;
      const name =
        typeof item.task_name === 'string' ? item.task_name.trim() : '';
      if (!name) {
        skipped++;
        continue;
      }
      const priority =
        item.priority === 'high' || item.priority === 'low'
          ? item.priority
          : 'medium';
      valid.push({
        task_name: name,
        priority,
        assigned_to:
          typeof item.assigned_to === 'string' ? item.assigned_to : '',
        deadline: typeof item.deadline === 'string' ? item.deadline : '',
      });
    }
    return { valid, skipped };
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

  async processCommand(
    actor: Actor,
    eventId: string,
    userMessage: string,
  ): Promise<object> {
    const userId = actor.sub;
    if (!userMessage || !userMessage.trim()) {
      throw new BadRequestException(
        'A command message is required / Vui lòng nhập nội dung lệnh',
      );
    }
    // The actor may only drive AI changes on an event they manage — checked
    // before we spend a DeepSeek call.
    await this.events.assertCanManageEvent(actor, eventId);
    // Throttle this expensive endpoint per user.
    this.assertWithinRateLimit(userId);
    // Don't attempt an external call with a missing key (would send
    // "Bearer undefined" and leak a confusing provider error to the client).
    const apiKey = this.config.get<string>('DEEPSEEK_API_KEY');
    if (!apiKey) {
      throw new BadRequestException(
        'The AI assistant is not configured / Trợ lý AI chưa được cấu hình',
      );
    }

    const systemPrompt = `You are an event operations assistant.
The user will describe tasks for an event.
Return ONLY a valid JSON array — no explanation, no markdown, no preamble.
Each item must have exactly these fields:
[
  {
    "task_name": "string",
    "priority": "low" | "medium" | "high",
    "assigned_to": "person name or email",
    "deadline": "YYYY-MM-DDTHH:mm:ss"
  }
]
If the user provides insufficient information, return instead:
{ "error": "insufficient info", "missing": ["field1", "field2"] }`;

    const aiRequest = await this.aiRequestRepo.save({
      user_id: userId,
      prompt: userMessage,
      status: 'pending',
    });

    try {
      const response = await axios.post(
        'https://api.deepseek.com/v1/chat/completions',
        {
          model: 'deepseek-chat',
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

      const data = response.data as DeepSeekResponse;
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
      const { valid, skipped } = this.validateItems(parsed);
      if (valid.length === 0) {
        await this.aiRequestRepo.update(aiRequest.request_id, {
          response: parsed as object,
          status: 'rejected',
        });
        return {
          status: 'rejected',
          reason: { error: 'The AI response contained no valid tasks.' },
        };
      }

      const createdTasks: object[] = [];
      for (const item of valid) {
        const priorityScore =
          item.priority === 'high' ? 90 : item.priority === 'medium' ? 50 : 10;

        // Guard against an invalid/missing date so we don't try to persist
        // an "Invalid Date" into the timestamp column.
        const parsedDeadline = item.deadline ? new Date(item.deadline) : null;
        const deadline =
          parsedDeadline && !isNaN(parsedDeadline.getTime())
            ? parsedDeadline
            : undefined;

        const task = await this.tasksService.create(
          {
            event_id: eventId,
            task_name: item.task_name,
            priority_label: item.priority,
            priority_score: priorityScore,
            priority_source: 'ai',
            deadline,
          },
          actor,
        );

        // Assign the task if the AI named a user we can match. The assignment
        // obeys the same rules as a manual one (actor must manage the event and,
        // for a plain manager, the assignee must be their own staff), so an
        // AI-suggested assignee outside the team is skipped rather than failing
        // the whole command.
        const assignee = await this.resolveAssignee(item.assigned_to);
        if (assignee) {
          try {
            await this.tasksService.assignUser(
              task.task_id,
              assignee.user_id,
              actor,
            );
          } catch {
            // Leave the task unassigned if the suggestion isn't permitted.
          }
        }

        await this.aiTaskMapRepo.save({
          request_id: aiRequest.request_id,
          task_id: task.task_id,
        });

        createdTasks.push({ ...task });
      }

      await this.aiRequestRepo.update(aiRequest.request_id, {
        response: parsed,
        status: 'success',
      });

      return { status: 'success', tasks_created: createdTasks, skipped };
    } catch (err) {
      await this.aiRequestRepo.update(aiRequest.request_id, {
        status: 'rejected',
      });
      throw err;
    }
  }
}
