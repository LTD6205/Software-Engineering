import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiRequest } from '../entities/ai-request.entity';
import { AiTaskMap } from '../entities/ai-task-map.entity';
import { User } from '../entities/user.entity';
import { TasksService } from '../tasks/tasks.service';
import axios from 'axios';

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
  ) {}

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
    userId: string,
    eventId: string,
    userMessage: string,
  ): Promise<object> {
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
        },
        {
          headers: {
            Authorization: `Bearer ${this.config.get('DEEPSEEK_API_KEY')}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const data = response.data as DeepSeekResponse;
      const raw: string = data.choices[0].message.content.trim();

      let parsed: unknown;

      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new BadRequestException('AI returned invalid JSON: ' + raw);
      }

      // Not an array means AI returned an error object
      if (!Array.isArray(parsed)) {
        await this.aiRequestRepo.update(aiRequest.request_id, {
          response: parsed as object,
          status: 'rejected',
        });
        return { status: 'rejected', reason: parsed };
      }

      const createdTasks: object[] = [];
      for (const item of parsed as ParsedTask[]) {
        const priorityScore =
          item.priority === 'high' ? 90 : item.priority === 'medium' ? 50 : 10;

        // Guard against an invalid/missing date so we don't try to persist
        // an "Invalid Date" into the timestamp column.
        const parsedDeadline = item.deadline ? new Date(item.deadline) : null;
        const deadline =
          parsedDeadline && !isNaN(parsedDeadline.getTime())
            ? parsedDeadline
            : undefined;

        const task = await this.tasksService.create({
          event_id: eventId,
          task_name: item.task_name,
          priority_label: item.priority,
          priority_score: priorityScore,
          priority_source: 'ai',
          deadline,
          created_by: userId,
        });

        // Assign the task if the AI named a user we can match.
        const assignee = await this.resolveAssignee(item.assigned_to);
        if (assignee) {
          await this.tasksService.assignUser(task.task_id, assignee.user_id);
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

      return { status: 'success', tasks_created: createdTasks };
    } catch (err) {
      await this.aiRequestRepo.update(aiRequest.request_id, {
        status: 'rejected',
      });
      throw err;
    }
  }
}
