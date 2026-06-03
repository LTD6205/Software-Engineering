import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';

// bcrypt is a native binding — spying on it doesn't work, so mock the module.
jest.mock('bcrypt');
const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

// A user that owns their own profile (used by updateProfile tests).
const SELF = {
  user_id: 'user-1',
  name: 'Sam',
  email: 'sam@example.com',
  phone: '0123456789',
  role: 'staff',
  password_hash: 'old-hash',
  manager_id: null as string | null,
  pending_manager_id: null as string | null,
};

// Build the service with a userRepo whose findOne resolves from a by-id map (so
// lookups don't depend on call order), plus find/create/save/update mocks.
function build(seed: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = {
    [SELF.user_id]: { ...SELF },
    ...seed,
  };
  const userRepo = {
    // findOne is used three ways: as a raw lookup by user_id, inside the public
    // findOne(id) (which adds a select), and as a duplicate-email check keyed on
    // email. Resolve all of them from the store.
    findOne: jest.fn(
      ({ where }: { where: { user_id?: string; email?: string } }) => {
        if (where?.user_id)
          return Promise.resolve(store[where.user_id] ?? null);
        if (where?.email) {
          const hit = Object.values(store).find(
            (u) => (u as { email?: string })?.email === where.email,
          );
          return Promise.resolve(hit ?? null);
        }
        return Promise.resolve(null);
      },
    ),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    create: jest.fn((dto: Record<string, unknown>) => ({ ...dto })),
    save: jest.fn((entity: Record<string, unknown>) =>
      Promise.resolve({ user_id: 'new-id', ...entity }),
    ),
    manager: { query: jest.fn().mockResolvedValue([]) },
  };
  const notifications = { notifyUser: jest.fn(), notifyUsers: jest.fn() };
  const service = new UsersService(userRepo as never, notifications as never);
  return { service, userRepo, notifications, store };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Sensible defaults: current password matches, new hashes are deterministic.
  mockedBcrypt.compare.mockResolvedValue(true as never);
  mockedBcrypt.hash.mockResolvedValue('hashed' as never);
});

describe('UsersService — profile / CRUD', () => {
  describe('updateProfile', () => {
    it('throws NotFound when the user does not exist', async () => {
      const { service } = build();
      await expect(
        service.updateProfile('ghost', { current_password: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequest when the current password is wrong', async () => {
      const { service } = build();
      mockedBcrypt.compare.mockResolvedValue(false as never);
      await expect(
        service.updateProfile('user-1', { current_password: 'wrong' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequest on an invalid email (missing "@")', async () => {
      const { service } = build();
      await expect(
        service.updateProfile('user-1', {
          current_password: 'right',
          email: 'no-at-sign',
        }),
      ).rejects.toThrow(/Email must contain/);
    });

    it('throws BadRequest on an email longer than 50 chars', async () => {
      const { service } = build();
      const longEmail = `${'a'.repeat(45)}@b.com`; // > 50 chars
      await expect(
        service.updateProfile('user-1', {
          current_password: 'right',
          email: longEmail,
        }),
      ).rejects.toThrow(/Email must contain/);
    });

    it('throws BadRequest on a phone that is not exactly 10 digits', async () => {
      const { service } = build();
      await expect(
        service.updateProfile('user-1', {
          current_password: 'right',
          phone: '12345',
        }),
      ).rejects.toThrow(/exactly 10 digits/);
    });

    it('throws Conflict when changing to an email another user already has', async () => {
      const { service } = build({
        'user-2': { user_id: 'user-2', email: 'taken@example.com' },
      });
      await expect(
        service.updateProfile('user-1', {
          current_password: 'right',
          email: 'taken@example.com',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('does NOT conflict-check when the email is unchanged', async () => {
      const { service, userRepo } = build();
      await service.updateProfile('user-1', {
        current_password: 'right',
        email: SELF.email, // same as current
        name: 'Sam 2',
      });
      // Only the initial owner lookup + the final findOne re-fetch should occur;
      // no extra duplicate-email lookup.
      expect(userRepo.findOne).toHaveBeenCalledTimes(2);
      // email is still passed through (it's provided), just no conflict check.
      expect(userRepo.update).toHaveBeenCalledWith('user-1', {
        email: SELF.email,
        name: 'Sam 2',
      });
    });

    it('hashes the new password and updates only the provided fields', async () => {
      const { service, userRepo } = build();
      await service.updateProfile('user-1', {
        current_password: 'right',
        name: 'New Name',
        new_password: 'brand-new',
      });
      expect(mockedBcrypt.hash).toHaveBeenCalledWith('brand-new', 10);
      expect(userRepo.update).toHaveBeenCalledWith('user-1', {
        name: 'New Name',
        password_hash: 'hashed',
      });
    });

    it('returns the user via findOne after updating', async () => {
      const { service, userRepo } = build();
      const result = await service.updateProfile('user-1', {
        current_password: 'right',
        name: 'X',
      });
      expect(result).toMatchObject({ user_id: 'user-1' });
      // The final call re-fetches the freshly updated row.
      expect(userRepo.update).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    const valid = {
      name: 'Newbie',
      email: 'new@example.com',
      password: 'secret',
      phone: '0123456789',
    };

    it.each([
      ['name', { ...valid, name: '' }],
      ['email', { ...valid, email: '' }],
      ['password', { ...valid, password: '' }],
      ['phone', { ...valid, phone: '' }],
    ])('throws BadRequest when %s is missing', async (_field, data) => {
      const { service } = build();
      await expect(service.create(data)).rejects.toThrow(BadRequestException);
    });

    it('throws Conflict on a duplicate email', async () => {
      const { service } = build();
      // SELF has email sam@example.com — reuse it to trigger the conflict.
      await expect(
        service.create({ ...valid, email: SELF.email }),
      ).rejects.toThrow(ConflictException);
    });

    // save() returns user_id 'new-id', and create() re-fetches it via findOne —
    // so seed the store with that id for tests that run the full happy path.
    const newIdSeed = {
      'new-id': { user_id: 'new-id', name: 'Newbie', role: 'staff' },
    };

    it("defaults role to 'staff' when none is given", async () => {
      const { service, userRepo } = build(newIdSeed);
      await service.create(valid);
      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'staff' }),
      );
    });

    it('keeps an explicitly provided role', async () => {
      const { service, userRepo } = build(newIdSeed);
      await service.create({ ...valid, role: 'manager' });
      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'manager' }),
      );
    });

    it('hashes the password and never persists the raw one', async () => {
      const { service, userRepo } = build(newIdSeed);
      await service.create(valid);
      expect(mockedBcrypt.hash).toHaveBeenCalledWith('secret', 10);
      const createdWith = userRepo.create.mock.calls[0][0];
      expect(createdWith.password_hash).toBe('hashed');
      expect(createdWith).not.toHaveProperty('password');
    });

    it('returns the saved user via findOne (so password_hash is not returned)', async () => {
      // save returns user_id 'new-id'; seed the store so findOne resolves it.
      const { service, userRepo } = build({
        'new-id': { user_id: 'new-id', name: 'Newbie', role: 'staff' },
      });
      const result = await service.create(valid);
      expect(userRepo.save).toHaveBeenCalled();
      expect(result).toMatchObject({ user_id: 'new-id' });
      expect(result).not.toHaveProperty('password_hash');
    });
  });

  describe('update', () => {
    it('throws NotFound when the user does not exist', async () => {
      const { service } = build();
      await expect(service.update('ghost', { name: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('applies only the provided fields', async () => {
      const { service, userRepo } = build();
      await service.update('user-1', { name: 'Renamed', is_active: false });
      expect(userRepo.update).toHaveBeenCalledWith('user-1', {
        name: 'Renamed',
        is_active: false,
      });
    });

    it('hashes the password when one is given', async () => {
      const { service, userRepo } = build();
      await service.update('user-1', { password: 'changeme' });
      expect(mockedBcrypt.hash).toHaveBeenCalledWith('changeme', 10);
      expect(userRepo.update).toHaveBeenCalledWith('user-1', {
        password_hash: 'hashed',
      });
    });

    it('passes role through and ignores undefined fields', async () => {
      const { service, userRepo } = build();
      await service.update('user-1', { role: 'manager' });
      expect(userRepo.update).toHaveBeenCalledWith('user-1', {
        role: 'manager',
      });
    });
  });

  describe('update — manager restrictions', () => {
    const ownStaff = {
      mine: { user_id: 'mine', role: 'staff', manager_id: 'mgr-me' },
    };
    const actor = { sub: 'mgr-me', role: 'manager' };

    it("forbids a manager from editing someone who isn't their own staff", async () => {
      const { service } = build({
        other: { user_id: 'other', role: 'staff', manager_id: 'mgr-x' },
      });
      await expect(
        service.update('other', { name: 'x' }, actor),
      ).rejects.toThrow(ForbiddenException);
    });

    it('forbids a manager from changing a role', async () => {
      const { service } = build(ownStaff);
      await expect(
        service.update('mine', { role: 'manager' }, actor),
      ).rejects.toThrow(/Only an admin can change/);
    });

    it("forbids a manager from resetting a user's password", async () => {
      const { service } = build(ownStaff);
      await expect(
        service.update('mine', { password: 'newpass' }, actor),
      ).rejects.toThrow(/reset/);
    });

    it('lets a manager rename their own staff', async () => {
      const { service, userRepo } = build(ownStaff);
      await service.update('mine', { name: 'Renamed' }, actor);
      expect(userRepo.update).toHaveBeenCalledWith('mine', { name: 'Renamed' });
    });

    it('lets an admin change a role on anyone', async () => {
      const { service, userRepo } = build({
        mine: { user_id: 'mine', role: 'staff', manager_id: 'mgr-x' },
      });
      await service.update(
        'mine',
        { role: 'manager' },
        {
          sub: 'admin-1',
          role: 'admin',
        },
      );
      expect(userRepo.update).toHaveBeenCalledWith('mine', { role: 'manager' });
    });
  });

  describe('create — manager ownership', () => {
    it('stamps new staff with the acting manager as their owner', async () => {
      const { service, userRepo } = build({
        'new-id': { user_id: 'new-id', role: 'staff' },
      });
      await service.create(
        {
          name: 'N',
          email: 'n@example.com',
          password: 'secret',
          phone: '0123456789',
        },
        { sub: 'mgr-me', role: 'manager' },
      );
      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ manager_id: 'mgr-me', role: 'staff' }),
      );
    });
  });

  describe('deactivate', () => {
    it('sets is_active=false and returns the message', async () => {
      const { service, userRepo } = build();
      const result = await service.deactivate('user-1');
      expect(userRepo.update).toHaveBeenCalledWith('user-1', {
        is_active: false,
      });
      expect(result).toEqual({ message: 'User deactivated' });
    });

    it('throws NotFound when the user does not exist', async () => {
      const { service } = build();
      await expect(service.deactivate('ghost')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it("includes 'is_active' in the select only for an admin viewer", async () => {
      const { service, userRepo } = build();
      await service.findAll('admin');
      const select = userRepo.find.mock.calls[0][0].select;
      expect(select).toContain('is_active');
    });

    it("omits 'is_active' from the select for a non-admin viewer", async () => {
      const { service, userRepo } = build();
      await service.findAll('manager');
      const select = userRepo.find.mock.calls[0][0].select;
      expect(select).not.toContain('is_active');
    });

    it("omits 'is_active' when no viewer role is given", async () => {
      const { service, userRepo } = build();
      await service.findAll();
      const select = userRepo.find.mock.calls[0][0].select;
      expect(select).not.toContain('is_active');
    });
  });

  describe('directory', () => {
    it('queries only active users with the limited select (no phone)', async () => {
      const { service, userRepo } = build();
      await service.directory();
      const args = userRepo.find.mock.calls[0][0];
      expect(args.where).toEqual({ is_active: true });
      expect(args.select).toEqual([
        'user_id',
        'name',
        'role',
        'email',
        'avatar',
        'manager_id',
      ]);
      expect(args.select).not.toContain('phone');
    });
  });
});
