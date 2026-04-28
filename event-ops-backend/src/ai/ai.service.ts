import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiRequest } from '../entities/ai-request.entity';
import { AiTaskMap } from '../entities/ai-task-map.entity';
import { TasksService } from '../tasks/tasks.service';
import axios from 'axios';

interface ParsedTask {
  task_name: string;
  priority: 'low' | 'medium' | 'high';
  assigned_to: string;
  deadline: string;
}

@Injectable()
export class AiService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(AiRequest) private aiRequestRepo: Repository<AiRequest>,
    @InjectRepository(AiTaskMap) private aiTaskMapRepo: Repository<AiTaskMap>,
    private readonly tasksService: TasksService,
  ) {}

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

      const raw: string = response.data.choices[0].message.content.trim();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let parsed: any;

      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new BadRequestException('AI returned invalid JSON: ' + raw);
      }

      // Not an array means AI returned an error object
      if (!Array.isArray(parsed)) {
        await this.aiRequestRepo.update(aiRequest.request_id, {
          response: parsed,
          status: 'rejected',
        });
        return { status: 'rejected', reason: parsed };
      }

      const createdTasks: object[] = [];
      for (const item of parsed as ParsedTask[]) {
        const priorityScore =
          item.priority === 'high' ? 90 : item.priority === 'medium' ? 50 : 10;

        const task = await this.tasksService.create({
          event_id:        eventId,
          task_name:       item.task_name,
          priority_label:  item.priority,
          priority_score:  priorityScore,
          priority_source: 'ai',
          deadline:        new Date(item.deadline),
          created_by:      userId,
        });

        await this.aiTaskMapRepo.save({
          request_id: aiRequest.request_id,
          task_id:    task.task_id,
        });

        createdTasks.push({ ...task });
      }

      await this.aiRequestRepo.update(aiRequest.request_id, {
        response: parsed,
        status: 'success',
      });

      return { status: 'success', tasks_created: createdTasks };

    } catch (err) {
      await this.aiRequestRepo.update(aiRequest.request_id, { status: 'rejected' });
      throw err;
    }
  }
}