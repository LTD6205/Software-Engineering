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
    update: jest.fn().mockResolvedValue({ task_id: 'tk1', task_name: 'A' }),
    setAssignees: jest.fn().mockResolvedValue(undefined),
    // The current task list fed to the model (empty unless a test overrides it).
    findAllByEvent: jest.fn().mockResolvedValue([]),
  };
  // The actor may always manage the event in these tests; event-scope
  // enforcement is covered by the EventsService/e2e tests.
  const events = {
    assertCanManageEvent: jest.fn().mockResolvedValue(undefined),
    // The service reads the event's date window to put it in the AI prompt.
    findOneForViewer: jest.fn().mockResolvedValue({
      event_id: 'e1',
      start_time: '2026-01-01T00:00:00Z',
      end_time: '2030-01-01T00:00:00Z',
    }),
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
      service.processCommand(ACTOR, { eventId: 'e1', message: 'do stuff' }),
    ).rejects.toThrow(ForbiddenException);
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('rejects when the DeepSeek API key is not configured', async () => {
    const { service, config } = build();
    config.get.mockReturnValue(undefined);
    await expect(
      service.processCommand(ACTOR, { eventId: 'e1', message: 'do stuff' }),
    ).rejects.toThrow(/not configured/);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('rejects a blank command message', async () => {
    const { service } = build();
    await expect(
      service.processCommand(ACTOR, { eventId: 'e1', message: '   ' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when the AI returns no valid task items', async () => {
    const { service, tasksService } = build();
    // One item missing task_name, one with a blank name â†’ nothing usable.
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([{ priority: 'high' }, { task_name: '   ' }]),
      ),
    );
    const result = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'do stuff',
    })) as {
      status: string;
    };
    expect(result.status).toBe('rejected');
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('rate-limits a user after too many requests', async () => {
    const { service } = build();
    mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify([])));
    for (let i = 0; i < 20; i++) {
      await service.processCommand(ACTOR, { eventId: 'e1', message: 'x' });
    }
    await expect(
      service.processCommand(ACTOR, { eventId: 'e1', message: 'x' }),
    ).rejects.toThrow(HttpException);
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

    const result = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'book a venue',
    })) as {
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

    await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'call the caterer',
    });

    expect(tasksService.assignUser).toHaveBeenCalledWith('tk1', 's5', ACTOR);
  });

  it('returns a structured rejection when the AI replies with an error object (not an array)', async () => {
    const { service, tasksService, aiRequestRepo } = build();
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify({ error: 'insufficient info', missing: ['deadline'] }),
      ),
    );

    const result = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'do stuff',
    })) as {
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

    await expect(
      service.processCommand(ACTOR, { eventId: 'e1', message: 'hi' }),
    ).rejects.toThrow(BadRequestException);
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

    await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'do a vague thing',
    });

    const arg = tasksService.create.mock.calls[0][0];
    expect(arg.deadline).toBeUndefined();
    expect(arg.priority_score).toBe(10);
  });

  it('updates an existing task referenced by name (reschedule + reprioritise)', async () => {
    const { service, tasksService } = build();
    tasksService.findAllByEvent.mockResolvedValue([
      { task_id: 'tk9', task_name: 'Book venue' },
    ]);
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            action: 'update',
            task_ref: 'Book venue',
            priority: 'high',
            deadline: '2026-08-01T09:00:00',
          },
        ]),
      ),
    );

    const result = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'push the venue booking to August and make it high priority',
    })) as { status: string; tasks_updated: unknown[] };

    expect(result.status).toBe('success');
    expect(result.tasks_updated).toHaveLength(1);
    expect(tasksService.update).toHaveBeenCalledWith(
      'tk9',
      expect.objectContaining({ priority_label: 'high', priority_score: 90 }),
      ACTOR,
    );
    // The new deadline is a real Date, not an "Invalid Date".
    const patch = tasksService.update.mock.calls[0][1];
    expect(patch.deadline instanceof Date).toBe(true);
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('reassigns an existing task to a matched active user', async () => {
    const { service, tasksService, userRepo } = build();
    tasksService.findAllByEvent.mockResolvedValue([
      { task_id: 'tk9', task_name: 'Call caterer' },
    ]);
    userRepo.findOne.mockResolvedValue({ user_id: 'carol' });
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            action: 'reassign',
            task_ref: 'Call caterer',
            assigned_to: 'Carol',
          },
        ]),
      ),
    );

    const result = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'move the caterer call to Carol',
    })) as { status: string; tasks_reassigned: unknown[] };

    expect(result.status).toBe('success');
    expect(result.tasks_reassigned).toHaveLength(1);
    expect(tasksService.setAssignees).toHaveBeenCalledWith(
      'tk9',
      ['carol'],
      ACTOR,
    );
  });

  it('returns the full set of result buckets on success', async () => {
    const { service, userRepo } = build();
    userRepo.findOne.mockResolvedValue(null);
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(JSON.stringify([{ task_name: 'A', priority: 'low' }])),
    );
    const r = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'x',
    })) as Record<string, unknown>;
    expect(r.status).toBe('success');
    for (const key of [
      'tasks_created',
      'tasks_updated',
      'tasks_reassigned',
      'tasks_deleted',
      'unassigned',
      'groups_changed',
      'events_changed',
      'users_changed',
      'unresolved',
      'rejected',
      'skipped',
    ]) {
      expect(r).toHaveProperty(key);
    }
  });

  it('reports an update whose task_ref matches nothing as unresolved (no write)', async () => {
    const { service, tasksService } = build();
    tasksService.findAllByEvent.mockResolvedValue([
      { task_id: 'tk9', task_name: 'Book venue' },
    ]);
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            action: 'update',
            task_ref: 'Nonexistent task',
            status: 'completed',
          },
        ]),
      ),
    );

    const result = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'finish X',
    })) as {
      status: string;
      unresolved: string[];
    };

    expect(result.status).toBe('success');
    expect(result.unresolved).toContain('Nonexistent task');
    expect(tasksService.update).not.toHaveBeenCalled();
  });
});
