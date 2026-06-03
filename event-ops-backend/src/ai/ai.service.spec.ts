import {
  BadRequestException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import axios from 'axios';
import { AiService } from './ai.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Wrap a DeepSeek chat-completion reply around an arbitrary content string.
function deepSeekReply(content: string) {
  return { data: { choices: [{ message: { content } }] } };
}

function build() {
  const config = { get: jest.fn().mockReturnValue('fake-key') };
  const aiRequestRepo = {
    save: jest.fn().mockResolvedValue({ request_id: 'req1' }),
    update: jest.fn(),
  };
  const aiTaskMapRepo = { save: jest.fn() };
  const userRepo = { findOne: jest.fn() };
  const tasksService = {
    create: jest.fn().mockResolvedValue({ task_id: 'tk1', task_name: 'A' }),
    assignUser: jest.fn(),
  };
  // The actor may always manage the event in these tests; event-scope
  // enforcement is covered by the EventsService/e2e tests.
  const events = {
    assertCanManageEvent: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AiService(
    config as never,
    aiRequestRepo as never,
    aiTaskMapRepo as never,
    userRepo as never,
    tasksService as never,
    events as never,
  );
  return {
    service,
    aiRequestRepo,
    aiTaskMapRepo,
    userRepo,
    tasksService,
    events,
    config,
  };
}

// The authenticated actor (derived from the JWT, not the request body).
const ACTOR = { sub: 'u1', role: 'manager' };

describe('AiService.processCommand', () => {
  afterEach(() => jest.clearAllMocks());

  it('refuses to run on an event the actor does not manage, before any DeepSeek call', async () => {
    const { service, events, tasksService } = build();
    events.assertCanManageEvent.mockRejectedValue(new ForbiddenException());
    await expect(
      service.processCommand(ACTOR, 'e1', 'do stuff'),
    ).rejects.toThrow(ForbiddenException);
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('rejects when the DeepSeek API key is not configured', async () => {
    const { service, config } = build();
    config.get.mockReturnValue(undefined);
    await expect(
      service.processCommand(ACTOR, 'e1', 'do stuff'),
    ).rejects.toThrow(/not configured/);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('rejects a blank command message', async () => {
    const { service } = build();
    await expect(service.processCommand(ACTOR, 'e1', '   ')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects when the AI returns no valid task items', async () => {
    const { service, tasksService } = build();
    // One item missing task_name, one with a blank name → nothing usable.
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([{ priority: 'high' }, { task_name: '   ' }]),
      ),
    );
    const result = (await service.processCommand(ACTOR, 'e1', 'do stuff')) as {
      status: string;
    };
    expect(result.status).toBe('rejected');
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('rate-limits a user after too many requests', async () => {
    const { service } = build();
    mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify([])));
    for (let i = 0; i < 20; i++) {
      await service.processCommand(ACTOR, 'e1', 'x');
    }
    await expect(service.processCommand(ACTOR, 'e1', 'x')).rejects.toThrow(
      HttpException,
    );
  });

  it('creates a task for each item in a valid JSON array response', async () => {
    const { service, tasksService, aiRequestRepo, userRepo } = build();
    userRepo.findOne.mockResolvedValue(null); // no assignee match
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            task_name: 'Book venue',
            priority: 'high',
            assigned_to: '',
            deadline: '2026-07-01T10:00:00',
          },
        ]),
      ),
    );

    const result = (await service.processCommand(
      ACTOR,
      'e1',
      'book a venue',
    )) as {
      status: string;
      tasks_created: unknown[];
    };

    expect(result.status).toBe('success');
    expect(result.tasks_created).toHaveLength(1);
    expect(tasksService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: 'e1',
        task_name: 'Book venue',
        priority_label: 'high',
        priority_score: 90,
        priority_source: 'ai',
      }),
      ACTOR,
    );
    expect(aiRequestRepo.update).toHaveBeenCalledWith(
      'req1',
      expect.objectContaining({ status: 'success' }),
    );
  });

  it('assigns the created task when the AI names a matching active user', async () => {
    const { service, tasksService, userRepo } = build();
    userRepo.findOne.mockResolvedValue({ user_id: 's5' });
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            task_name: 'Call caterer',
            priority: 'medium',
            assigned_to: 'staff05',
            deadline: '2026-07-01T10:00:00',
          },
        ]),
      ),
    );

    await service.processCommand(ACTOR, 'e1', 'call the caterer');

    expect(tasksService.assignUser).toHaveBeenCalledWith('tk1', 's5', ACTOR);
  });

  it('returns a structured rejection when the AI replies with an error object (not an array)', async () => {
    const { service, tasksService, aiRequestRepo } = build();
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify({ error: 'insufficient info', missing: ['deadline'] }),
      ),
    );

    const result = (await service.processCommand(ACTOR, 'e1', 'do stuff')) as {
      status: string;
    };

    expect(result.status).toBe('rejected');
    expect(tasksService.create).not.toHaveBeenCalled();
    expect(aiRequestRepo.update).toHaveBeenCalledWith(
      'req1',
      expect.objectContaining({ status: 'rejected' }),
    );
  });

  it('throws BadRequest and marks the request rejected when the AI returns invalid JSON', async () => {
    const { service, aiRequestRepo } = build();
    mockedAxios.post.mockResolvedValue(deepSeekReply('not json at all'));

    await expect(service.processCommand(ACTOR, 'e1', 'hi')).rejects.toThrow(
      BadRequestException,
    );
    expect(aiRequestRepo.update).toHaveBeenCalledWith(
      'req1',
      expect.objectContaining({ status: 'rejected' }),
    );
  });

  it('skips an invalid deadline so an "Invalid Date" is never persisted', async () => {
    const { service, tasksService, userRepo } = build();
    userRepo.findOne.mockResolvedValue(null);
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            task_name: 'Vague task',
            priority: 'low',
            assigned_to: '',
            deadline: 'whenever',
          },
        ]),
      ),
    );

    await service.processCommand(ACTOR, 'e1', 'do a vague thing');

    const arg = tasksService.create.mock.calls[0][0];
    expect(arg.deadline).toBeUndefined();
    expect(arg.priority_score).toBe(10);
  });
});
