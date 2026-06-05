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

function build(role = 'manager') {
  const config = { get: jest.fn().mockReturnValue('fake-key') };
  const aiRequestRepo = {
    save: jest.fn().mockResolvedValue({ request_id: 'req1' }),
    update: jest.fn(),
    findOne: jest.fn(),
  };
  const aiTaskMapRepo = { save: jest.fn() };
  const userRepo = { findOne: jest.fn() };
  const tasksService = {
    create: jest.fn().mockResolvedValue({ task_id: 'tk1', task_name: 'A' }),
    assignUser: jest.fn(),
    update: jest.fn().mockResolvedValue({ task_id: 'tk1', task_name: 'A' }),
    setAssignees: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    merge: jest.fn().mockResolvedValue({ group_id: 'g1' }),
    addToGroup: jest.fn().mockResolvedValue(undefined),
    ungroup: jest.fn().mockResolvedValue(undefined),
    renameGroup: jest.fn().mockResolvedValue(undefined),
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
    // The set of events the actor can see (used to resolve event_ref).
    findForViewer: jest.fn().mockResolvedValue([]),
    // Event write methods (organizer/admin only).
    create: jest.fn().mockResolvedValue({ event_id: 'e9', event_name: 'Gala' }),
    update: jest.fn().mockResolvedValue({ event_id: 'e1', event_name: 'X' }),
    remove: jest.fn().mockResolvedValue(undefined),
    addManager: jest.fn().mockResolvedValue(undefined),
    removeManager: jest.fn().mockResolvedValue(undefined),
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

  it('rename_group resolves a group by title and calls renameGroup', async () => {
    const { service, tasksService } = build();
    tasksService.findAllByEvent.mockResolvedValue([
      { task_id: 't1', task_name: 'A', group_id: 'g1', group_title: 'Catering' },
    ]);
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          { action: 'rename_group', group_ref: 'Catering', title: 'Food' },
        ]),
      ),
    );
    await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'rename catering to food',
    });
    expect(tasksService.renameGroup).toHaveBeenCalledWith(
      'g1',
      'Food',
      expect.objectContaining({ sub: 'u1' }),
    );
  });

  it('delete resolves a task and calls remove; unmatched ref → unresolved', async () => {
    const { service, tasksService } = build();
    tasksService.findAllByEvent.mockResolvedValue([
      { task_id: 't1', task_name: 'A' },
    ]);
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          { action: 'delete', task_ref: 'A' },
          { action: 'delete', task_ref: 'ghost' },
        ]),
      ),
    );
    const r = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'delete A and ghost',
    })) as { tasks_deleted: unknown[]; unresolved: string[] };
    expect(tasksService.remove).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ sub: 'u1' }),
    );
    expect(r.tasks_deleted).toEqual([{ task_id: 't1', task_name: 'A' }]);
    expect(r.unresolved).toContain('ghost');
  });

  it('unassign clears assignees via setAssignees([])', async () => {
    const { service, tasksService } = build();
    tasksService.findAllByEvent.mockResolvedValue([
      { task_id: 't1', task_name: 'A' },
    ]);
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(JSON.stringify([{ action: 'unassign', task_ref: 'A' }])),
    );
    const r = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'unassign A',
    })) as { unassigned: unknown[] };
    expect(tasksService.setAssignees).toHaveBeenCalledWith(
      't1',
      [],
      expect.anything(),
    );
    expect(r.unassigned).toEqual([{ task_id: 't1', task_name: 'A' }]);
  });

  it('merge resolves source+target and calls merge', async () => {
    const { service, tasksService } = build();
    tasksService.findAllByEvent.mockResolvedValue([
      { task_id: 't1', task_name: 'A' },
      { task_id: 't2', task_name: 'B' },
    ]);
    tasksService.merge.mockResolvedValue({ group_id: 'g1' });
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([{ action: 'merge', task_ref: 'A', target_ref: 'B' }]),
      ),
    );
    const r = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'merge A into B',
    })) as { groups_changed: Array<Record<string, unknown>> };
    expect(tasksService.merge).toHaveBeenCalledWith(
      't1',
      't2',
      expect.anything(),
    );
    expect(r.groups_changed[0]).toMatchObject({
      action: 'merge',
      group_id: 'g1',
    });
  });

  it('add_to_group resolves a group by title and adds the task', async () => {
    const { service, tasksService } = build();
    tasksService.findAllByEvent.mockResolvedValue([
      { task_id: 't1', task_name: 'A', group_id: 'g1', group_title: 'Setup' },
      { task_id: 't2', task_name: 'B' },
    ]);
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          { action: 'add_to_group', group_ref: 'Setup', task_ref: 'B' },
        ]),
      ),
    );
    const r = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'add B to setup',
    })) as { groups_changed: Array<Record<string, unknown>> };
    expect(tasksService.addToGroup).toHaveBeenCalledWith(
      'g1',
      't2',
      expect.anything(),
    );
    expect(r.groups_changed[0]).toMatchObject({
      action: 'add_to_group',
      group_id: 'g1',
    });
  });

  it('ungroup resolves a task and calls ungroup', async () => {
    const { service, tasksService } = build();
    tasksService.findAllByEvent.mockResolvedValue([
      { task_id: 't1', task_name: 'A', group_id: 'g1', group_title: 'Setup' },
    ]);
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(JSON.stringify([{ action: 'ungroup', task_ref: 'A' }])),
    );
    const r = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'ungroup A',
    })) as { groups_changed: Array<Record<string, unknown>> };
    expect(tasksService.ungroup).toHaveBeenCalledWith(
      't1',
      expect.anything(),
    );
    expect(r.groups_changed[0]).toMatchObject({ action: 'ungroup' });
  });

  it('links two same-group creates into one group', async () => {
    const { service, tasksService } = build();
    let n = 0;
    tasksService.create.mockImplementation(async () => ({
      task_id: 'tk' + ++n,
      task_name: 'T' + n,
    }));
    tasksService.merge.mockResolvedValue({ group_id: 'g1' });
    tasksService.findAllByEvent.mockResolvedValue([]);
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          { task_name: 'Buy cake', priority: 'low', group: 'Food' },
          { task_name: 'Order pizza', priority: 'low', group: 'Food' },
        ]),
      ),
    );
    const r = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'plan food',
    })) as { tasks_created: unknown[] };
    expect(tasksService.create).toHaveBeenCalledTimes(2);
    expect(tasksService.merge).toHaveBeenCalledWith(
      'tk1',
      'tk2',
      expect.anything(),
    );
    expect(r.tasks_created).toHaveLength(2);
  });

  it('returns an answer when the model replies with {answer}', async () => {
    const { service, tasksService } = build();
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(JSON.stringify({ answer: '2 tasks overdue.' })),
    );
    const r = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'what is overdue?',
    })) as { status: string; answer: string };
    expect(r).toEqual({ status: 'answered', answer: '2 tasks overdue.' });
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('returns a clarification question when the model asks back', async () => {
    const { service } = build();
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify({ clarification_needed: true, question: 'Which event?' }),
      ),
    );
    const r = (await service.processCommand(ACTOR, {
      message: 'reschedule it',
    })) as { status: string; question: string; request_id: string };
    expect(r.status).toBe('needs_clarification');
    expect(r.question).toBe('Which event?');
    expect(r.request_id).toBeDefined();
  });

  it('forwards history into the chat messages in order', async () => {
    const { service } = build();
    mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify([])));
    await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'the gala',
      history: [
        { role: 'user', content: 'reschedule it' },
        { role: 'assistant', content: 'Which event?' },
      ],
    });
    const body = mockedAxios.post.mock.calls[0][1] as {
      messages: { role: string; content: string }[];
    };
    const roles = body.messages.map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
    expect(body.messages[3].content).toBe('the gala');
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

  it('ask mode persists a plan and executes nothing', async () => {
    const { service, tasksService, aiRequestRepo } = build();
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(JSON.stringify([{ task_name: 'A', priority: 'low' }])),
    );
    const r = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'add A',
      mode: 'ask',
    })) as { status: string; request_id: string; plan: unknown[] };
    expect(r.status).toBe('pending_confirmation');
    expect(r.request_id).toBe('req1');
    expect(Array.isArray(r.plan)).toBe(true);
    expect(tasksService.create).not.toHaveBeenCalled();
    expect(aiRequestRepo.update).toHaveBeenCalledWith(
      'req1',
      expect.objectContaining({ status: 'awaiting_confirmation' }),
    );
  });

  it('confirm executes a stored plan owned by the actor', async () => {
    const { service, tasksService, aiRequestRepo } = build();
    aiRequestRepo.findOne.mockResolvedValue({
      request_id: 'req1',
      user_id: 'u1',
      status: 'awaiting_confirmation',
      created_at: new Date(),
      response: {
        plan: [
          {
            action: 'create',
            task_name: 'A',
            priority: 'low',
            assigned_to: '',
            deadline: '',
          },
        ],
        eventId: 'e1',
      },
    });
    const r = (await service.confirmCommand(ACTOR, 'req1')) as {
      status: string;
    };
    expect(tasksService.create).toHaveBeenCalled();
    expect(r.status).toBe('success');
  });

  it('confirm rejects a foreign request (403) and an expired one (400)', async () => {
    const { service, aiRequestRepo } = build();
    aiRequestRepo.findOne.mockResolvedValue({
      request_id: 'req1',
      user_id: 'someone-else',
      status: 'awaiting_confirmation',
      created_at: new Date(),
      response: { plan: [], eventId: 'e1' },
    });
    await expect(service.confirmCommand(ACTOR, 'req1')).rejects.toThrow(
      /permission|forbidden/i,
    );
    aiRequestRepo.findOne.mockResolvedValue({
      request_id: 'req1',
      user_id: 'u1',
      status: 'awaiting_confirmation',
      created_at: new Date(Date.now() - 16 * 60 * 1000),
      response: { plan: [], eventId: 'e1' },
    });
    await expect(service.confirmCommand(ACTOR, 'req1')).rejects.toThrow(
      /expired/i,
    );
  });

  it('cancel marks the request cancelled', async () => {
    const { service, aiRequestRepo } = build();
    aiRequestRepo.findOne.mockResolvedValue({
      request_id: 'req1',
      user_id: 'u1',
      status: 'awaiting_confirmation',
      created_at: new Date(),
      response: { plan: [], eventId: 'e1' },
    });
    const r = (await service.cancelCommand(ACTOR, 'req1')) as {
      status: string;
    };
    expect(r.status).toBe('cancelled');
    expect(aiRequestRepo.update).toHaveBeenCalledWith('req1', {
      status: 'cancelled',
    });
  });

  it('resolveEventRef resolves by id and by case-insensitive name', () => {
    const { service } = build();
    const resolve = (
      service as unknown as {
        resolveEventRef: (
          ref: string | undefined,
          events: { event_id: string; event_name: string }[],
          defaultEventId?: string,
        ) => string | null;
      }
    ).resolveEventRef.bind(service);
    const events = [
      { event_id: 'e1', event_name: 'Spring Gala' },
      { event_id: 'e2', event_name: 'Summer Fest' },
    ];
    expect(resolve('e2', events)).toBe('e2');
    expect(resolve('spring gala', events)).toBe('e1');
    expect(resolve('unknown', events)).toBeNull();
    expect(resolve(undefined, events, 'e1')).toBe('e1');
    expect(resolve(undefined, events)).toBeNull();
  });
});
