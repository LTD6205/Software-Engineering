import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { Not } from 'typeorm';

// A staff member and the two managers involved in a reassignment.
const OLD_MGR = { user_id: 'mgr-old', name: 'Olivia', role: 'manager' };
const NEW_MGR = { user_id: 'mgr-new', name: 'Nina', role: 'manager' };
const STAFF = {
  user_id: 'staff-1',
  name: 'Sam',
  role: 'staff',
  manager_id: 'mgr-old',
  pending_manager_id: null as string | null,
};

// Build the service with a userRepo whose findOne resolves from a by-id map, so
// the many lookups inside each method don't depend on call order.
function build(seed: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = {
    [OLD_MGR.user_id]: { ...OLD_MGR },
    [NEW_MGR.user_id]: { ...NEW_MGR },
    [STAFF.user_id]: { ...STAFF },
    ...seed,
  };
  const manager: Record<string, jest.Mock> = {
    query: jest.fn().mockResolvedValue([]),
  };
  const userRepo = {
    findOne: jest.fn(({ where }: { where: { user_id?: string } }) =>
      Promise.resolve(where?.user_id ? (store[where.user_id] ?? null) : null),
    ),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
    manager,
  };
  // acceptReassign wraps its writes in a transaction; the proxied entity-manager
  // delegates to the same mocks so the existing assertions still hold.
  manager.transaction = jest.fn((cb: (em: unknown) => unknown) =>
    cb({
      query: manager.query,
      update: (_e: unknown, criteria: unknown, partial: unknown) =>
        userRepo.update(criteria, partial),
    }),
  );
  const notifications = { notifyUser: jest.fn(), notifyUsers: jest.fn() };
  const service = new UsersService(userRepo as never, notifications as never);
  return { service, userRepo, notifications, store };
}

// Pull out the recipient ids notifyUser was called with (order-independent).
function recipients(notifyUser: jest.Mock): string[] {
  return notifyUser.mock.calls.map((c) => c[0]);
}

describe('UsersService — staff→manager reassignment', () => {
  describe('requestReassign', () => {
    it('sets pending_manager_id and notifies the three parties', async () => {
      const { service, userRepo, notifications } = build();

      await service.requestReassign('staff-1', 'mgr-new', {
        sub: 'mgr-old',
        role: 'manager',
      });

      expect(userRepo.update).toHaveBeenCalledWith('staff-1', {
        pending_manager_id: 'mgr-new',
      });
      // owner manager, target manager, and the staff member are all told.
      expect(notifications.notifyUser).toHaveBeenCalledTimes(3);
      expect(recipients(notifications.notifyUser)).toEqual(
        expect.arrayContaining(['mgr-old', 'mgr-new', 'staff-1']),
      );
      // The move is only proposed — the owner is NOT changed yet.
      expect(userRepo.update).not.toHaveBeenCalledWith(
        'staff-1',
        expect.objectContaining({ manager_id: 'mgr-new' }),
      );
    });

    it('lets an admin initiate even when they are not the current owner', async () => {
      const { service, userRepo } = build();
      await service.requestReassign('staff-1', 'mgr-new', {
        sub: 'someone-else',
        role: 'admin',
      });
      expect(userRepo.update).toHaveBeenCalledWith('staff-1', {
        pending_manager_id: 'mgr-new',
      });
    });

    it('throws NotFound when the staff member does not exist', async () => {
      const { service } = build();
      await expect(
        service.requestReassign('ghost', 'mgr-new', {
          sub: 'mgr-old',
          role: 'manager',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects reassigning a non-staff user', async () => {
      const { service } = build();
      await expect(
        service.requestReassign('mgr-new', 'mgr-old', {
          sub: 'mgr-new',
          role: 'admin',
        }),
      ).rejects.toThrow(/Only staff members can be reassigned/);
    });

    it("forbids a manager who is not the staff's current owner", async () => {
      const { service } = build();
      await expect(
        service.requestReassign('staff-1', 'mgr-new', {
          sub: 'mgr-new', // not the owner (mgr-old)
          role: 'manager',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('requires a target manager id', async () => {
      const { service } = build();
      await expect(
        service.requestReassign('staff-1', '', {
          sub: 'mgr-old',
          role: 'manager',
        }),
      ).rejects.toThrow(/target manager is required/);
    });

    it('rejects a target that is not a manager', async () => {
      const { service } = build({
        'not-mgr': { user_id: 'not-mgr', name: 'X', role: 'staff' },
      });
      await expect(
        service.requestReassign('staff-1', 'not-mgr', {
          sub: 'mgr-old',
          role: 'manager',
        }),
      ).rejects.toThrow(/target must be a manager/);
    });

    it('rejects moving a staff member to the manager they already report to', async () => {
      const { service } = build();
      await expect(
        service.requestReassign('staff-1', 'mgr-old', {
          sub: 'mgr-old',
          role: 'manager',
        }),
      ).rejects.toThrow(/already reports to that manager/);
    });
  });

  describe('acceptReassign', () => {
    // Staff with a pending move from old → new.
    const pendingSeed = {
      'staff-1': { ...STAFF, pending_manager_id: 'mgr-new' },
    };

    it('flips ownership to the new manager and clears the pending flag', async () => {
      const { service, userRepo, notifications } = build(pendingSeed);

      await service.acceptReassign('staff-1', {
        sub: 'mgr-new',
        role: 'manager',
      });

      expect(userRepo.update).toHaveBeenCalledWith('staff-1', {
        manager_id: 'mgr-new',
        pending_manager_id: null,
      });
      expect(recipients(notifications.notifyUser)).toEqual(
        expect.arrayContaining(['mgr-old', 'mgr-new', 'staff-1']),
      );
    });

    it('forbids a manager who is not the pending target', async () => {
      const { service } = build(pendingSeed);
      await expect(
        service.acceptReassign('staff-1', {
          sub: 'mgr-old', // the old owner, not the pending target
          role: 'manager',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("lets an admin accept on the target manager's behalf", async () => {
      const { service, userRepo } = build(pendingSeed);
      await service.acceptReassign('staff-1', {
        sub: 'admin-x',
        role: 'admin',
      });
      expect(userRepo.update).toHaveBeenCalledWith('staff-1', {
        manager_id: 'mgr-new',
        pending_manager_id: null,
      });
    });
  });

  describe('rejectReassign', () => {
    const pendingSeed = {
      'staff-1': { ...STAFF, pending_manager_id: 'mgr-new' },
    };

    it('clears the pending flag WITHOUT changing the owner, and notifies three parties', async () => {
      const { service, userRepo, notifications } = build(pendingSeed);

      await service.rejectReassign('staff-1', {
        sub: 'mgr-new',
        role: 'manager',
      });

      expect(userRepo.update).toHaveBeenCalledWith('staff-1', {
        pending_manager_id: null,
      });
      // owner is never reassigned on a reject.
      expect(userRepo.update).not.toHaveBeenCalledWith(
        'staff-1',
        expect.objectContaining({ manager_id: expect.anything() }),
      );
      expect(recipients(notifications.notifyUser)).toEqual(
        expect.arrayContaining(['mgr-old', 'mgr-new', 'staff-1']),
      );
    });

    it('forbids someone who is not the pending target', async () => {
      const { service } = build(pendingSeed);
      await expect(
        service.rejectReassign('staff-1', { sub: 'mgr-old', role: 'manager' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('cancelReassign', () => {
    const pendingSeed = {
      'staff-1': { ...STAFF, pending_manager_id: 'mgr-new' },
    };

    it('lets the requesting owner withdraw a pending move and notifies three parties', async () => {
      const { service, userRepo, notifications } = build(pendingSeed);

      await service.cancelReassign('staff-1', {
        sub: 'mgr-old',
        role: 'manager',
      });

      expect(userRepo.update).toHaveBeenCalledWith('staff-1', {
        pending_manager_id: null,
      });
      expect(recipients(notifications.notifyUser)).toEqual(
        expect.arrayContaining(['mgr-old', 'mgr-new', 'staff-1']),
      );
    });

    it('rejects cancelling when there is no pending request', async () => {
      // default STAFF has pending_manager_id = null.
      const { service } = build();
      await expect(
        service.cancelReassign('staff-1', { sub: 'mgr-old', role: 'manager' }),
      ).rejects.toThrow(/no pending reassignment to cancel/);
    });

    it('forbids a non-owner manager (e.g. the target) from cancelling', async () => {
      const { service } = build(pendingSeed);
      await expect(
        service.cancelReassign('staff-1', { sub: 'mgr-new', role: 'manager' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFound when the staff member does not exist', async () => {
      const { service } = build();
      await expect(
        service.cancelReassign('ghost', { sub: 'mgr-old', role: 'manager' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

describe('UsersService.directory — role-scoped visibility', () => {
  it.each(['staff', 'manager', 'organizer'])(
    '%s sees every active user except admins',
    async (role) => {
      const { service, userRepo } = build();
      await service.directory({ sub: 'x', role });
      const where = userRepo.find.mock.calls[0][0].where;
      expect(where).toEqual({ is_active: true, role: Not('admin') });
    },
  );

  it('admins see everyone', async () => {
    const { service, userRepo } = build();
    await service.directory({ sub: 'a-1', role: 'admin' });
    const where = userRepo.find.mock.calls[0][0].where;
    expect(where).toEqual({ is_active: true });
  });
});
