import { NotificationsService } from './notifications.service';

function makeRepo() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn((x) => Promise.resolve({ notification_id: 'n1', ...x })),
    update: jest.fn(),
    delete: jest.fn(),
    manager: { query: jest.fn() },
  };
}

function build() {
  const taskRepo = makeRepo();
  const notifRepo = makeRepo();
  const assignRepo = makeRepo();
  const gateway = { sendToUser: jest.fn(), broadcast: jest.fn(), broadcastToEvent: jest.fn() };
  const service = new NotificationsService(
    taskRepo as never,
    notifRepo as never,
    assignRepo as never,
    gateway as never,
  );
  return { service, taskRepo, notifRepo, gateway };
}

describe('NotificationsService', () => {
  describe('notifyUser', () => {
    it('saves a notification and pushes it live over the socket', async () => {
      const { service, notifRepo, gateway } = build();
      await service.notifyUser('u1', 'task', 'hello', 't1', 'e1');

      expect(notifRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'u1',
          type: 'task',
          message: 'hello',
          task_id: 't1',
          event_id: 'e1',
        }),
      );
      expect(gateway.sendToUser).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ type: 'task', message: 'hello' }),
      );
    });

    it('does nothing when the userId is empty', async () => {
      const { service, notifRepo, gateway } = build();
      await service.notifyUser('', 'task', 'hello');
      expect(notifRepo.save).not.toHaveBeenCalled();
      expect(gateway.sendToUser).not.toHaveBeenCalled();
    });
  });

  describe('notifyUsers', () => {
    it('de-duplicates and skips blank recipients', async () => {
      const { service, notifRepo } = build();
      await service.notifyUsers(['u1', 'u1', '', 'u2'], 'event', 'hi');
      // u1 once + u2 once = 2 saves (blank skipped, duplicate collapsed).
      expect(notifRepo.save).toHaveBeenCalledTimes(2);
    });

    it('handles a null list without error', async () => {
      const { service, notifRepo } = build();
      await service.notifyUsers(null as never, 'event', 'hi');
      expect(notifRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('markRead', () => {
    it('scopes the update to the requesting user (cannot read others notifications)', () => {
      const { service, notifRepo } = build();
      service.markRead('n1', 'u1');
      expect(notifRepo.update).toHaveBeenCalledWith(
        { notification_id: 'n1', user_id: 'u1' },
        { is_read: true },
      );
    });
  });

  describe('getAll', () => {
    it('caps history at 50 rows, newest first', () => {
      const { service, notifRepo } = build();
      service.getAll('u1');
      expect(notifRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: 'u1' },
          take: 50,
          order: { created_at: 'DESC' },
        }),
      );
    });
  });

  describe('checkDeadlines (cron)', () => {
    it('flags past-deadline tasks as overdue and notifies their recipients', async () => {
      const { service, taskRepo, notifRepo, gateway } = build();
      // No upcoming reminders; one overdue task.
      taskRepo.find
        .mockResolvedValueOnce([]) // upcoming (within 24h)
        .mockResolvedValueOnce([{ task_id: 'late', task_name: 'Ship it' }]); // overdue
      notifRepo.manager.query.mockResolvedValue([{ uid: 'u1' }]);
      notifRepo.findOne.mockResolvedValue(null); // no existing unread dup

      await service.checkDeadlines();

      expect(taskRepo.update).toHaveBeenCalledWith('late', {
        status: 'overdue',
      });
      expect(notifRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'overdue', task_id: 'late' }),
      );
      expect(gateway.sendToUser).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ type: 'overdue' }),
      );
    });

    it('does not re-notify a recipient who already has an alert of that type', async () => {
      const { service, taskRepo, notifRepo } = build();
      taskRepo.find
        .mockResolvedValueOnce([]) // upcoming
        .mockResolvedValueOnce([{ task_id: 'late', task_name: 'Ship it' }]); // overdue
      notifRepo.manager.query.mockResolvedValue([{ uid: 'u1' }]);
      notifRepo.findOne.mockResolvedValue({ notification_id: 'existing' });

      await service.checkDeadlines();

      // Still marks overdue, but does NOT create a duplicate notification.
      expect(taskRepo.update).toHaveBeenCalledWith('late', {
        status: 'overdue',
      });
      expect(notifRepo.save).not.toHaveBeenCalled();
    });

    it('dedupes regardless of read state (query has no is_read filter)', async () => {
      const { service, taskRepo, notifRepo } = build();
      taskRepo.find
        .mockResolvedValueOnce([{ task_id: 'soon', task_name: 'Prep' }]) // upcoming reminder
        .mockResolvedValueOnce([]); // overdue
      notifRepo.manager.query.mockResolvedValue([{ uid: 'u1' }]);
      // The recipient already has a READ reminder for this task.
      notifRepo.findOne.mockResolvedValue({
        notification_id: 'old',
        is_read: true,
      });

      await service.checkDeadlines();

      // No new reminder is created even though the prior one was read.
      expect(notifRepo.save).not.toHaveBeenCalled();
      const where = notifRepo.findOne.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('is_read');
    });
  });
});
