import {
  BadRequestException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import axios from 'axios';
import { AiService } from './ai.service';
import { resolveEventRef } from './ai.resolve';

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
  const userRepo = { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) };
  const tasksService = {
    create: jest.fn().mockResolvedValue({ task_id: 'tk1', task_name: 'A' }),
    assignUser: jest.fn(),
    update: jest.fn().mockResolvedValue({ task_id: 'tk1', task_name: 'A' }),
    setAssignees: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    undoLastChange: jest
      .fn()
      .mockResolvedValue({ undone: { type: 'edit', label: 'A · name' } }),
    // Undo-batch helpers the AI uses to make one command a single undo op.
    newUndoOp: jest.fn(() => ({
      created: [],
      deleted: [],
      edited: [],
      ungrouped: [],
    })),
    recordOp: jest.fn().mockResolvedValue(undefined),
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
    updateDates: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    addManager: jest.fn().mockResolvedValue(undefined),
    removeManager: jest.fn().mockResolvedValue(undefined),
  };
  // Account/team management (Phase 5). Each method enforces its own
  // ownership/role rules in production; mocked to "allow" here.
  const usersService = {
    create: jest.fn().mockResolvedValue({ user_id: 'n1', name: 'New' }),
    update: jest.fn().mockResolvedValue({ user_id: 'n1', name: 'New' }),
    requestReassign: jest.fn().mockResolvedValue(undefined),
    acceptReassign: jest.fn().mockResolvedValue(undefined),
    rejectReassign: jest.fn().mockResolvedValue(undefined),
    cancelReassign: jest.fn().mockResolvedValue(undefined),
    removeFromTeam: jest.fn().mockResolvedValue(undefined),
    // Eligible managers the AI seeds into a newly-created event (empty by
    // default; a test overrides it to assert they are passed to events.create).
    findManagerIdsWithActiveStaff: jest.fn().mockResolvedValue([]),
  };
  const service = new AiService(
    config as never,
    aiRequestRepo as never,
    aiTaskMapRepo as never,
    userRepo as never,
    tasksService as never,
    events as never,
    usersService as never,
  );
  return {
    service,
    aiRequestRepo,
    aiTaskMapRepo,
    userRepo,
    tasksService,
    events,
    usersService,
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

  it('parses a JSON array wrapped in a ```json markdown fence', async () => {
    const { service, tasksService, userRepo } = build();
    userRepo.findOne.mockResolvedValue(null);
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        '```json\n[{"task_name":"Fenced task","priority":"low","assigned_to":"","deadline":""}]\n```',
      ),
    );
    const result = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'add a task',
    })) as { status: string; tasks_created: unknown[] };
    expect(result.status).toBe('success');
    expect(result.tasks_created).toHaveLength(1);
    expect(tasksService.create).toHaveBeenCalled();
  });

  it('gives an AI-created task a start_time before its deadline (a real, draggable window)', async () => {
    const { service, tasksService, userRepo } = build();
    userRepo.findOne.mockResolvedValue(null);
    // Model supplies only a deadline; the service must still fill in a start_time
    // so the task has a length and never collapses to a zero-width block (which
    // would trip the deadline > start_time constraint the moment it's dragged).
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            task_name: 'Decorate',
            priority: 'medium',
            assigned_to: '',
            deadline: '2030-01-01T10:00:00Z',
          },
        ]),
      ),
    );
    await service.processCommand(ACTOR, { eventId: 'e1', message: 'add a task' });
    const arg = tasksService.create.mock.calls[0][0] as {
      start_time?: Date;
      deadline?: Date;
    };
    expect(arg.start_time).toBeInstanceOf(Date);
    expect(arg.deadline).toBeInstanceOf(Date);
    expect((arg.start_time as Date).getTime()).toBeLessThan(
      (arg.deadline as Date).getTime(),
    );
  });

  it('honours a model-supplied start_time for a created task (in-window)', async () => {
    const { service, tasksService, userRepo } = build();
    userRepo.findOne.mockResolvedValue(null);
    // Times sit well inside the test event's window (2026-01-01 .. 2030-01-01),
    // so fitWindow leaves them untouched.
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            task_name: 'Setup',
            priority: 'low',
            assigned_to: '',
            start_time: '2027-01-01T08:00:00Z',
            deadline: '2027-01-01T10:00:00Z',
          },
        ]),
      ),
    );
    await service.processCommand(ACTOR, { eventId: 'e1', message: 'add setup' });
    const arg = tasksService.create.mock.calls[0][0] as { start_time?: Date };
    expect((arg.start_time as Date).toISOString()).toBe(
      '2027-01-01T08:00:00.000Z',
    );
  });

  it('fits a task into a SHORT event window instead of letting it overflow and be rejected', async () => {
    const { service, tasksService, userRepo, events } = build();
    userRepo.findOne.mockResolvedValue(null);
    // A 12-hour event window starting tomorrow (kept relative to now so the test
    // never goes stale); the model schedules a deadline days past the end (what
    // it does for short events). fitWindow must pull it inside.
    const day = 24 * 60 * 60 * 1000;
    const winStart = new Date(new Date(Date.now() + day).setHours(8, 0, 0, 0)).toISOString();
    const winEnd = new Date(new Date(Date.now() + day).setHours(20, 0, 0, 0)).toISOString();
    // Model's reply overshoots the window by days.
    const replyStart = new Date(Date.now() + 4 * day).toISOString();
    const replyDeadline = new Date(Date.now() + 7 * day).toISOString();
    events.findOneForViewer.mockResolvedValue({
      event_id: 'e1',
      start_time: winStart,
      end_time: winEnd,
    });
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            task_name: 'Cater',
            priority: 'medium',
            assigned_to: '',
            start_time: replyStart,
            deadline: replyDeadline,
          },
        ]),
      ),
    );
    await service.processCommand(ACTOR, { eventId: 'e1', message: 'cater the party' });
    const arg = tasksService.create.mock.calls[0][0] as {
      start_time?: Date;
      deadline?: Date;
    };
    const start = (arg.start_time as Date).getTime();
    const end = (arg.deadline as Date).getTime();
    // Both ends sit inside the event window, with start strictly before deadline.
    expect(start).toBeGreaterThanOrEqual(new Date(winStart).getTime());
    expect(end).toBeLessThanOrEqual(new Date(winEnd).getTime());
    expect(start).toBeLessThan(end);
  });

  it('slides a past task window forward to start now (keeping its length) so a plan for "today" is not rejected', async () => {
    const { service, tasksService, userRepo } = build();
    userRepo.findOne.mockResolvedValue(null);
    // Model schedules a 2-hour task entirely in the past — what happens when a
    // "today" plan lays a morning task out in the afternoon. It must NOT be left
    // in the past (assertNotInPast would reject it); the window is moved to begin
    // at "now" with its 2-hour length preserved.
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            task_name: 'Buy cake',
            priority: 'medium',
            assigned_to: '',
            start_time: '2020-01-01T08:00:00Z',
            deadline: '2020-01-01T10:00:00Z',
          },
        ]),
      ),
    );
    const before = Date.now();
    await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'buy a cake today',
    });
    const after = Date.now();
    const arg = tasksService.create.mock.calls[0][0] as {
      start_time?: Date;
      deadline?: Date;
    };
    const start = (arg.start_time as Date).getTime();
    const end = (arg.deadline as Date).getTime();
    // Starts at "now" (within the call window) — never in the past.
    expect(start).toBeGreaterThanOrEqual(before);
    expect(start).toBeLessThanOrEqual(after);
    // The model's 2-hour duration is preserved.
    expect(end - start).toBe(2 * 60 * 60 * 1000);
  });

  it('asks the provider for a strict JSON object (response_format)', async () => {
    const { service } = build();
    mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify([])));
    await service.processCommand(ACTOR, { eventId: 'e1', message: 'noop' });
    const body = mockedAxios.post.mock.calls[0][1] as {
      response_format?: { type?: string };
    };
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('executes a wrapped { kind: "actions", actions: [...] } response', async () => {
    const { service, tasksService, userRepo } = build();
    userRepo.findOne.mockResolvedValue(null);
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify({
          kind: 'actions',
          actions: [
            {
              task_name: 'Wrapped task',
              priority: 'low',
              assigned_to: '',
              deadline: '2030-01-01T09:00:00Z',
            },
          ],
        }),
      ),
    );
    const result = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'add a task',
    })) as { status: string; tasks_created: unknown[] };
    expect(result.status).toBe('success');
    expect(result.tasks_created).toHaveLength(1);
    expect(tasksService.create).toHaveBeenCalled();
  });

  it('returns answered for a wrapped { kind: "answer" } response', async () => {
    const { service } = build();
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify({ kind: 'answer', answer: 'You have 3 events.' }),
      ),
    );
    const result = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'how many events?',
    })) as { status: string; answer: string };
    expect(result.status).toBe('answered');
    expect(result.answer).toBe('You have 3 events.');
  });

  it('returns needs_clarification for a wrapped { kind: "clarification" } response', async () => {
    const { service } = build();
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify({ kind: 'clarification', question: 'Which event?' }),
      ),
    );
    const result = (await service.processCommand(ACTOR, {
      message: 'do the thing',
    })) as { status: string; question: string };
    expect(result.status).toBe('needs_clarification');
    expect(result.question).toBe('Which event?');
  });

  it('shows each task\'s current assignee in the prompt (so reassignment is scoped to the right person)', async () => {
    const { service, tasksService } = build();
    tasksService.findAllByEvent.mockResolvedValue([
      { task_id: 't1', task_name: 'Alpha', assignees: [{ user_id: 'u1', name: 'Alice' }] },
      { task_id: 't2', task_name: 'Beta', assignees: [{ user_id: 'u6', name: 'Frank' }] },
      { task_id: 't3', task_name: 'Gamma', assignees: [] },
    ]);
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(JSON.stringify({ kind: 'answer', answer: 'ok' })),
    );
    await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'who has what?',
    });
    const body = mockedAxios.post.mock.calls[0][1] as {
      messages: { role: string; content: string }[];
    };
    const systemPrompt = body.messages[0].content;
    expect(systemPrompt).toContain('"Alpha" (id t1) — assigned to: Alice');
    expect(systemPrompt).toContain('"Beta" (id t2) — assigned to: Frank');
    expect(systemPrompt).toContain('"Gamma" (id t3) — assigned to: unassigned');
  });

  it('retries without response_format when a provider rejects it (4xx) — model switches keep working', async () => {
    const { service, userRepo } = build();
    userRepo.findOne.mockResolvedValue(null);
    mockedAxios.post.mockReset();
    mockedAxios.post
      .mockRejectedValueOnce({ response: { status: 400 } })
      .mockResolvedValueOnce(
        deepSeekReply(
          JSON.stringify({
            kind: 'actions',
            actions: [
              {
                task_name: 'X',
                priority: 'low',
                assigned_to: '',
                deadline: '2030-01-01T09:00:00Z',
              },
            ],
          }),
        ),
      );
    const result = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'add a task',
    })) as { status: string };
    expect(result.status).toBe('success');
    // First attempt sent response_format; the 4xx triggered a retry without it.
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(
      (mockedAxios.post.mock.calls[0][1] as { response_format?: unknown })
        .response_format,
    ).toEqual({ type: 'json_object' });
    expect(
      (mockedAxios.post.mock.calls[1][1] as { response_format?: unknown })
        .response_format,
    ).toBeUndefined();
  });

  it('routes an "undo" action to the event-level undoLastChange', async () => {
    const { service, tasksService } = build();
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(JSON.stringify([{ action: 'undo' }])),
    );
    const result = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'undo the last change',
    })) as { status: string; tasks_updated: unknown[] };
    expect(result.status).toBe('success');
    expect(tasksService.undoLastChange).toHaveBeenCalledWith('e1', ACTOR);
    expect(result.tasks_updated).toHaveLength(1);
  });

  it('does not run an event-scoped manage check when no eventId is given', async () => {
    const { service, events } = build();
    mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify([])));
    await service.processCommand(ACTOR, { message: 'a cross-event command' });
    // No eventId → no assertCanManageEvent (which would otherwise query with an
    // empty-string UUID and 500 in production).
    expect(events.assertCanManageEvent).not.toHaveBeenCalled();
  });

  it('create_event with an unparseable date is rejected without calling events.create', async () => {
    const { service, events } = build();
    events.create = jest.fn();
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            action: 'create_event',
            event_name: 'Bad Date Gala',
            start_time: 'not-a-date',
            end_time: 'also-bad',
          },
        ]),
      ),
    );
    const r = (await service.processCommand(
      { sub: 'o1', role: 'organizer' },
      { message: 'make an event' },
    )) as { events_changed: unknown[]; rejected: { reason: string }[] };
    expect(events.create).not.toHaveBeenCalled();
    expect(r.events_changed).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/date/i);
  });

  it('update_user resolves the target without an is_active filter (admin can reactivate)', async () => {
    const { service, userRepo, usersService } = build();
    let captured: unknown;
    userRepo.findOne.mockImplementation((opts: { where: unknown }) => {
      captured = opts.where;
      return Promise.resolve({ user_id: 'd1', name: 'Bob', role: 'staff' });
    });
    usersService.update = jest.fn().mockResolvedValue({ user_id: 'd1' });
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          { action: 'update_user', user_ref: 'Bob', is_active: true },
        ]),
      ),
    );
    await service.processCommand({ sub: 'a1', role: 'admin' }, { message: 'reactivate Bob' });
    expect(usersService.update).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ is_active: true }),
      expect.objectContaining({ role: 'admin' }),
    );
    // The resolver query must NOT constrain is_active (else a deactivated
    // account could never be matched for reactivation).
    expect(JSON.stringify(captured)).not.toContain('is_active');
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
      expect.objectContaining({ undoOp: expect.anything() }),
    );
    expect(aiRequestRepo.update).toHaveBeenCalledWith(
      'req1',
      expect.objectContaining({ status: 'success' }),
    );
  });

  it("never creates an AI task on 'auto' — a stray priority is coerced to a concrete label", async () => {
    const { service, tasksService, userRepo } = build();
    userRepo.findOne.mockResolvedValue(null);
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            task_name: 'Book venue',
            // The model shouldn't emit 'auto', but if it does it must not slip
            // through: AI tasks always carry a fixed priority, never the
            // auto-prioritise source.
            priority: 'auto',
            assigned_to: '',
            deadline: '2026-07-01T10:00:00',
          },
        ]),
      ),
    );

    await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'book a venue',
    });

    const created = tasksService.create.mock.calls[0][0] as {
      priority_label: string;
      priority_source: string;
    };
    expect(created.priority_source).toBe('ai');
    expect(['low', 'medium', 'high']).toContain(created.priority_label);
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
      expect.objectContaining({ undoOp: expect.anything() }),
    );
    // The new deadline is a real Date, not an "Invalid Date".
    const patch = tasksService.update.mock.calls[0][1];
    expect(patch.deadline instanceof Date).toBe(true);
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('renames a task and moves its start_time via update', async () => {
    const { service, tasksService } = build();
    tasksService.findAllByEvent.mockResolvedValue([
      { task_id: 'tk9', task_name: 'Setup' },
    ]);
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            action: 'update',
            task_ref: 'Setup',
            task_name: 'Stage setup',
            start_time: '2026-08-01T07:00:00',
          },
        ]),
      ),
    );
    const result = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'rename Setup to Stage setup and start it at 7am Aug 1',
    })) as { status: string; tasks_updated: unknown[] };
    expect(result.status).toBe('success');
    expect(result.tasks_updated).toHaveLength(1);
    const patch = tasksService.update.mock.calls[0][1] as {
      task_name?: string;
      start_time?: Date;
    };
    expect(patch.task_name).toBe('Stage setup');
    expect(patch.start_time instanceof Date).toBe(true);
  });

  it('names a new AI-created group (no blank "Untitled group")', async () => {
    const { service, tasksService } = build();
    tasksService.findAllByEvent.mockResolvedValue([]);
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            task_name: 'Order cake',
            priority: 'low',
            assigned_to: '',
            deadline: '2030-01-01T09:00:00Z',
            group: 'Catering',
          },
          {
            task_name: 'Hire caterer',
            priority: 'low',
            assigned_to: '',
            deadline: '2030-01-01T10:00:00Z',
            group: 'Catering',
          },
        ]),
      ),
    );
    await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'plan catering with two tasks in a Catering group',
    });
    expect(tasksService.merge).toHaveBeenCalled();
    // The group the AI named must be titled, not left blank.
    expect(tasksService.renameGroup).toHaveBeenCalledWith(
      'g1',
      'Catering',
      ACTOR,
    );
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
      expect.objectContaining({ undoOp: expect.anything() }),
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
    const events = [
      { event_id: 'e1', event_name: 'Spring Gala' },
      { event_id: 'e2', event_name: 'Summer Fest' },
    ];
    expect(resolveEventRef('e2', events)).toBe('e2');
    expect(resolveEventRef('spring gala', events)).toBe('e1');
    expect(resolveEventRef('unknown', events)).toBeNull();
    expect(resolveEventRef(undefined, events, 'e1')).toBe('e1');
    expect(resolveEventRef(undefined, events)).toBeNull();
  });

  it('create_event (organizer) calls events.create with created_by from JWT', async () => {
    const { service, events } = build('organizer');
    events.create.mockResolvedValue({ event_id: 'e9', event_name: 'Gala' });
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            action: 'create_event',
            event_name: 'Gala',
            start_time: '2026-07-01T09:00:00',
            end_time: '2026-07-02T18:00:00',
          },
        ]),
      ),
    );
    const r = (await service.processCommand(
      { sub: 'o1', role: 'organizer' },
      { message: 'make a gala next month' },
    )) as { events_changed: Array<Record<string, unknown>> };
    expect(events.create).toHaveBeenCalledWith(
      expect.objectContaining({ event_name: 'Gala', created_by: 'o1' }),
      [],
    );
    expect(r.events_changed[0]).toMatchObject({
      action: 'create_event',
      event_id: 'e9',
    });
  });

  it('create_event seeds the new event with every manager who has active staff', async () => {
    const { service, events, usersService } = build('organizer');
    events.create.mockResolvedValue({ event_id: 'e9', event_name: 'Gala' });
    usersService.findManagerIdsWithActiveStaff.mockResolvedValue(['m1', 'm2']);
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            action: 'create_event',
            event_name: 'Gala',
            start_time: '2026-07-01T09:00:00',
            end_time: '2026-07-02T18:00:00',
          },
        ]),
      ),
    );
    await service.processCommand(
      { sub: 'o1', role: 'organizer' },
      { message: 'make a gala next month' },
    );
    // The eligible managers are passed through as the event's manager list.
    expect(events.create).toHaveBeenCalledWith(
      expect.objectContaining({ event_name: 'Gala', created_by: 'o1' }),
      ['m1', 'm2'],
    );
  });

  it('create_event is rejected for a manager (role gate)', async () => {
    const { service, events } = build('manager');
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            action: 'create_event',
            event_name: 'X',
            start_time: '2026-07-01T09:00:00',
            end_time: '2026-07-02T18:00:00',
          },
        ]),
      ),
    );
    const r = (await service.processCommand(
      { sub: 'u1', role: 'manager' },
      { message: 'make event' },
    )) as { rejected: Array<{ reason: string }> };
    expect(events.create).not.toHaveBeenCalled();
    expect(r.rejected[0].reason).toMatch(/role/i);
  });

  it('update_event resolves event_ref then updates after the manage check', async () => {
    const { service, events } = build('organizer');
    events.findForViewer.mockResolvedValue([
      { event_id: 'e1', event_name: 'Spring Gala' },
    ]);
    events.update.mockResolvedValue({ event_id: 'e1', event_name: 'Autumn Gala' });
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            action: 'update_event',
            event_ref: 'Spring Gala',
            event_name: 'Autumn Gala',
          },
        ]),
      ),
    );
    const r = (await service.processCommand(
      { sub: 'o1', role: 'organizer' },
      { message: 'rename spring gala' },
    )) as { events_changed: Array<Record<string, unknown>> };
    expect(events.assertCanManageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'o1' }),
      'e1',
    );
    expect(events.update).toHaveBeenCalledWith('e1', {
      event_name: 'Autumn Gala',
      description: undefined,
    });
    expect(r.events_changed[0]).toMatchObject({
      action: 'update_event',
      event_id: 'e1',
    });
  });

  it('update_event with a start_time changes the event dates via updateDates (Vietnam time → UTC, shift)', async () => {
    const { service, events } = build('organizer');
    events.findForViewer.mockResolvedValue([
      { event_id: 'e1', event_name: 'Spring Gala' },
    ]);
    // Current event window the handler fills the unspecified (end) side from.
    events.findOneForViewer.mockResolvedValue({
      event_id: 'e1',
      event_name: 'Spring Gala',
      start_time: '2026-06-01T00:00:00Z',
      end_time: '2026-06-30T17:00:00.000Z',
    });
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            action: 'update_event',
            event_ref: 'Spring Gala',
            start_time: '2026-06-10T00:00:00', // bare = Vietnam local (UTC+7)
          },
        ]),
      ),
    );
    const r = (await service.processCommand(
      { sub: 'o1', role: 'organizer' },
      { message: 'chuyển ngày bắt đầu sự kiện Spring Gala thành ngày 10 tháng 6' },
    )) as { events_changed: Array<Record<string, unknown>> };
    // 2026-06-10T00:00 Vietnam (UTC+7) == 2026-06-09T17:00:00Z; end filled from current.
    expect(events.updateDates).toHaveBeenCalledWith(
      'e1',
      '2026-06-09T17:00:00.000Z',
      '2026-06-30T17:00:00.000Z',
      'shift',
    );
    expect(r.events_changed[0]).toMatchObject({
      action: 'update_event',
      event_id: 'e1',
    });
  });

  it('interprets a bare task time as Vietnam local (UTC+7), persisting the correct UTC instant', async () => {
    const { service, tasksService } = build('manager');
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            action: 'update',
            task_ref: 'Lên kế hoạch chương trình',
            start_time: '2026-06-10T20:00:00', // "8h tối" Vietnam time
          },
        ]),
      ),
    );
    // The task must already exist so the update resolves.
    (tasksService.findAllByEvent as jest.Mock).mockResolvedValue([
      { task_id: 'tk1', task_name: 'Lên kế hoạch chương trình', event_id: 'e1' },
    ]);
    await service.processCommand(
      { sub: 'm1', role: 'manager' },
      { eventId: 'e1', message: 'chỉnh task bắt đầu lúc 8h tối' },
    );
    const patch = (tasksService.update as jest.Mock).mock.calls[0][1] as {
      start_time?: Date;
    };
    // 20:00 Vietnam (UTC+7) == 13:00Z — NOT 20:00Z (the old +7h bug showed 03:00 local).
    expect((patch.start_time as Date).toISOString()).toBe(
      '2026-06-10T13:00:00.000Z',
    );
  });

  it('delete_event resolves event_ref then removes; unmatched ref → unresolved', async () => {
    const { service, events } = build('organizer');
    events.findForViewer.mockResolvedValue([
      { event_id: 'e1', event_name: 'Spring Gala' },
    ]);
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          { action: 'delete_event', event_ref: 'Spring Gala' },
          { action: 'delete_event', event_ref: 'ghost' },
        ]),
      ),
    );
    const r = (await service.processCommand(
      { sub: 'o1', role: 'organizer' },
      { message: 'delete spring gala and ghost' },
    )) as {
      events_changed: Array<Record<string, unknown>>;
      unresolved: string[];
    };
    expect(events.remove).toHaveBeenCalledWith('e1');
    expect(r.events_changed[0]).toMatchObject({
      action: 'delete_event',
      event_id: 'e1',
    });
    expect(r.unresolved).toContain('ghost');
  });

  it('add_event_manager resolves refs and calls addManager after the manage check', async () => {
    const { service, events, userRepo } = build('organizer');
    events.findForViewer.mockResolvedValue([
      { event_id: 'e1', event_name: 'Spring Gala' },
    ]);
    userRepo.findOne.mockResolvedValue({
      user_id: 'm5',
      name: 'Mona',
      role: 'manager',
    });
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            action: 'add_event_manager',
            event_ref: 'Spring Gala',
            manager_ref: 'Mona',
          },
        ]),
      ),
    );
    const r = (await service.processCommand(
      { sub: 'o1', role: 'organizer' },
      { message: 'add Mona to spring gala' },
    )) as { events_changed: Array<Record<string, unknown>> };
    expect(events.assertCanManageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'o1' }),
      'e1',
    );
    expect(events.addManager).toHaveBeenCalledWith('e1', 'm5', true);
    expect(r.events_changed[0]).toMatchObject({
      action: 'add_event_manager',
      event_id: 'e1',
    });
  });

  it('remove_event_manager resolves refs and calls removeManager', async () => {
    const { service, events, userRepo } = build('organizer');
    events.findForViewer.mockResolvedValue([
      { event_id: 'e1', event_name: 'Spring Gala' },
    ]);
    userRepo.findOne.mockResolvedValue({
      user_id: 'm5',
      name: 'Mona',
      role: 'manager',
    });
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            action: 'remove_event_manager',
            event_ref: 'Spring Gala',
            manager_ref: 'Mona',
          },
        ]),
      ),
    );
    const r = (await service.processCommand(
      { sub: 'o1', role: 'organizer' },
      { message: 'remove Mona from spring gala' },
    )) as { events_changed: Array<Record<string, unknown>> };
    expect(events.assertCanManageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'o1' }),
      'e1',
    );
    expect(events.removeManager).toHaveBeenCalledWith('e1', 'm5');
    expect(r.events_changed[0]).toMatchObject({
      action: 'remove_event_manager',
      event_id: 'e1',
    });
  });

  it('add_event_manager → unresolved when the ref is not a manager', async () => {
    const { service, events, userRepo } = build('organizer');
    events.findForViewer.mockResolvedValue([
      { event_id: 'e1', event_name: 'Spring Gala' },
    ]);
    userRepo.findOne.mockResolvedValue({
      user_id: 's5',
      name: 'Sam',
      role: 'staff',
    });
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            action: 'add_event_manager',
            event_ref: 'Spring Gala',
            manager_ref: 'Sam',
          },
        ]),
      ),
    );
    const r = (await service.processCommand(
      { sub: 'o1', role: 'organizer' },
      { message: 'add Sam to spring gala' },
    )) as { unresolved: string[] };
    expect(events.addManager).not.toHaveBeenCalled();
    expect(r.unresolved).toContain('Sam');
  });

  it('manager create_user is rejected by the role gate (admin-only)', async () => {
    const { service, usersService } = build('manager');
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            action: 'create_user',
            name: 'New',
            email: 'n@x.com',
            phone: '0900000001',
            role: 'staff',
          },
        ]),
      ),
    );
    const r = (await service.processCommand(
      { sub: 'm1', role: 'manager' },
      { message: 'add a staff member named New' },
    )) as { rejected: Array<{ reason: string }> };
    // create_user is now admin-only — a manager cannot create accounts at all,
    // not even staff (the central role gate blocks it before the service runs).
    expect(usersService.create).not.toHaveBeenCalled();
    expect(r.rejected[0].reason).toMatch(/role/i);
  });

  it('manager reset_password is rejected by the role gate', async () => {
    const { service, usersService } = build('manager');
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            action: 'reset_password',
            user_ref: 'staff01@eventops.com',
            new_password: 'x12345',
          },
        ]),
      ),
    );
    const r = (await service.processCommand(
      { sub: 'm1', role: 'manager' },
      { message: 'reset their password' },
    )) as { rejected: Array<{ reason: string }> };
    expect(usersService.update).not.toHaveBeenCalled();
    expect(r.rejected[0].reason).toMatch(/role/i);
  });

  it('request_reassign resolves both refs and calls requestReassign', async () => {
    const { service, usersService, userRepo } = build('manager');
    userRepo.findOne
      .mockResolvedValueOnce({ user_id: 's5', name: 'Sam', role: 'staff' })
      .mockResolvedValueOnce({ user_id: 'm9', name: 'Mona', role: 'manager' });
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          {
            action: 'request_reassign',
            staff_ref: 'Sam',
            target_manager_ref: 'Mona',
          },
        ]),
      ),
    );
    const r = (await service.processCommand(
      { sub: 'm1', role: 'manager' },
      { message: 'move Sam to Mona' },
    )) as { users_changed: Array<Record<string, unknown>> };
    expect(usersService.requestReassign).toHaveBeenCalledWith(
      's5',
      'm9',
      expect.objectContaining({ sub: 'm1' }),
    );
    expect(r.users_changed[0]).toMatchObject({
      action: 'request_reassign',
      user_id: 's5',
    });
  });

  it('remove_from_team resolves staff_ref and calls removeFromTeam', async () => {
    const { service, usersService, userRepo } = build('manager');
    userRepo.findOne.mockResolvedValue({
      user_id: 's5',
      name: 'Sam',
      role: 'staff',
    });
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([{ action: 'remove_from_team', staff_ref: 'Sam' }]),
      ),
    );
    const r = (await service.processCommand(
      { sub: 'm1', role: 'manager' },
      { message: 'remove Sam from my team' },
    )) as { users_changed: Array<Record<string, unknown>> };
    expect(usersService.removeFromTeam).toHaveBeenCalledWith(
      's5',
      expect.objectContaining({ sub: 'm1' }),
    );
    expect(r.users_changed[0]).toMatchObject({
      action: 'remove_from_team',
      user_id: 's5',
    });
  });

  it('accept_reassign resolves staff_ref and calls acceptReassign', async () => {
    const { service, usersService, userRepo } = build('manager');
    userRepo.findOne.mockResolvedValue({
      user_id: 's5',
      name: 'Sam',
      role: 'staff',
    });
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([{ action: 'accept_reassign', staff_ref: 'Sam' }]),
      ),
    );
    const r = (await service.processCommand(
      { sub: 'm1', role: 'manager' },
      { message: 'accept Sam' },
    )) as { users_changed: Array<Record<string, unknown>> };
    expect(usersService.acceptReassign).toHaveBeenCalledWith(
      's5',
      expect.objectContaining({ sub: 'm1' }),
    );
    expect(r.users_changed[0]).toMatchObject({
      action: 'accept_reassign',
      user_id: 's5',
    });
  });

  it('includes viewable events and the assignable roster in the system prompt', async () => {
    const { service, events, userRepo } = build('manager');
    events.findForViewer.mockResolvedValue([
      {
        event_id: 'e1',
        event_name: 'Gala',
        start_time: '2026-07-01T09:00:00Z',
        end_time: '2026-07-02T18:00:00Z',
      },
    ]);
    userRepo.find.mockResolvedValue([
      { user_id: 's1', name: 'Bob', email: 'bob@x.com', is_active: true },
    ]);
    mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify([])));
    await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'what is going on?',
    });
    const body = mockedAxios.post.mock.calls[0][1] as {
      messages: { role: string; content: string }[];
    };
    const systemContent = body.messages[0].content;
    expect(systemContent).toContain('Gala');
    expect(systemContent).toContain('Bob');
    // The manager's own active staff is the assignable roster.
    expect(userRepo.find).toHaveBeenCalledWith({
      where: { manager_id: 'u1', is_active: true },
    });
  });

  it('lists other managers as reassignment targets in the system prompt', async () => {
    const { service, userRepo } = build('manager');
    userRepo.find.mockImplementation((opts: { where: Record<string, unknown> }) => {
      // staff roster query vs. the managers (reassign-target) query
      if (opts.where.role === 'manager') {
        return Promise.resolve([
          { user_id: 'u1', name: 'Me', email: 'me@x.com' }, // self — filtered out
          { user_id: 'm3', name: 'Mona', email: 'manager03@eventops.com' },
        ]);
      }
      return Promise.resolve([
        { user_id: 's1', name: 'Bob', email: 'bob@x.com', is_active: true },
      ]);
    });
    mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify([])));
    await service.processCommand(ACTOR, { message: 'who can I move staff to?' });
    const body = mockedAxios.post.mock.calls[0][1] as {
      messages: { role: string; content: string }[];
    };
    const systemContent = body.messages[0].content;
    expect(systemContent).toContain('Managers you can reassign staff to');
    expect(systemContent).toContain('manager03@eventops.com');
    // The actor themselves is excluded from the reassignment-target list.
    expect(systemContent).not.toContain('me@x.com');
  });

  it('executes a generative create plan without asking (anti-nag)', async () => {
    const { service, userRepo } = build('manager');
    userRepo.findOne.mockResolvedValue(null);
    mockedAxios.post.mockResolvedValue(
      deepSeekReply(
        JSON.stringify([
          { task_name: 'Buy cake', priority: 'low', group: 'Food' },
          { task_name: 'Send invites', priority: 'medium' },
          { task_name: 'Book venue', priority: 'high' },
        ]),
      ),
    );
    const r = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'create all the tasks for a birthday party',
    })) as { status: string; tasks_created: unknown[] };
    expect(r.status).toBe('success');
    expect(r.tasks_created.length).toBeGreaterThanOrEqual(1);
  });

  it('caps execution at 40 actions and counts the overflow as skipped', async () => {
    const { service, userRepo } = build('manager');
    userRepo.findOne.mockResolvedValue(null);
    const items = Array.from({ length: 45 }, (_, i) => ({
      task_name: `Task ${i}`,
      priority: 'low',
    }));
    mockedAxios.post.mockResolvedValue(deepSeekReply(JSON.stringify(items)));
    const r = (await service.processCommand(ACTOR, {
      eventId: 'e1',
      message: 'make 45 tasks',
    })) as { status: string; tasks_created: unknown[]; skipped: number };
    expect(r.status).toBe('success');
    expect(r.tasks_created).toHaveLength(40);
    expect(r.skipped).toBeGreaterThanOrEqual(5);
  });
});
