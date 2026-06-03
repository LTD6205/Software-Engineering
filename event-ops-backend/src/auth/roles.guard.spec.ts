import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

// Build a fake ExecutionContext carrying a request whose `user` has the given
// role (or no user at all when role is undefined).
function ctxWithUser(role?: string): ExecutionContext {
  const request = role ? { user: { role } } : {};
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
  } as unknown as ExecutionContext;
}

// A Reflector stub that always returns the same required-roles array.
function reflectorReturning(roles: string[] | undefined): Reflector {
  return { get: () => roles } as unknown as Reflector;
}

describe('RolesGuard (exact role match)', () => {
  it('allows any authenticated user when no @Roles metadata is present', () => {
    const guard = new RolesGuard(reflectorReturning(undefined));
    expect(guard.canActivate(ctxWithUser('staff'))).toBe(true);
  });

  it('allows any authenticated user when @Roles is an empty array', () => {
    const guard = new RolesGuard(reflectorReturning([]));
    expect(guard.canActivate(ctxWithUser('staff'))).toBe(true);
  });

  describe('exact match — no inheritance between roles', () => {
    it('admits a manager to a @Roles("manager") route', () => {
      const guard = new RolesGuard(reflectorReturning(['manager']));
      expect(guard.canActivate(ctxWithUser('manager'))).toBe(true);
    });

    it('rejects an ORGANIZER from a @Roles("manager") route (the fix)', () => {
      const guard = new RolesGuard(reflectorReturning(['manager']));
      expect(() => guard.canActivate(ctxWithUser('organizer'))).toThrow(
        ForbiddenException,
      );
    });

    it('rejects staff from a @Roles("manager") route', () => {
      const guard = new RolesGuard(reflectorReturning(['manager']));
      expect(() => guard.canActivate(ctxWithUser('staff'))).toThrow(
        ForbiddenException,
      );
    });

    it('admits an organizer to a @Roles("organizer") route', () => {
      const guard = new RolesGuard(reflectorReturning(['organizer']));
      expect(guard.canActivate(ctxWithUser('organizer'))).toBe(true);
    });

    it('rejects a MANAGER from a @Roles("organizer") route', () => {
      const guard = new RolesGuard(reflectorReturning(['organizer']));
      expect(() => guard.canActivate(ctxWithUser('manager'))).toThrow(
        ForbiddenException,
      );
    });

    it('admits any role explicitly listed in a multi-role @Roles(...)', () => {
      const guard = new RolesGuard(reflectorReturning(['manager', 'admin']));
      expect(guard.canActivate(ctxWithUser('manager'))).toBe(true);
    });

    it('rejects a role not listed in a multi-role @Roles(...)', () => {
      // 'organizer' is NOT in the list, so it is denied (no level inheritance).
      const guard = new RolesGuard(reflectorReturning(['manager', 'admin']));
      expect(() => guard.canActivate(ctxWithUser('organizer'))).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('admin is the superuser', () => {
    it('admits admin to a @Roles("manager") route even when not listed', () => {
      const guard = new RolesGuard(reflectorReturning(['manager']));
      expect(guard.canActivate(ctxWithUser('admin'))).toBe(true);
    });

    it('admits admin to a @Roles("organizer") route even when not listed', () => {
      const guard = new RolesGuard(reflectorReturning(['organizer']));
      expect(guard.canActivate(ctxWithUser('admin'))).toBe(true);
    });

    it('admits admin to a @Roles("admin") route', () => {
      const guard = new RolesGuard(reflectorReturning(['admin']));
      expect(guard.canActivate(ctxWithUser('admin'))).toBe(true);
    });
  });

  describe('rejects unauthenticated / unknown', () => {
    it('treats an unknown role as denied', () => {
      const guard = new RolesGuard(reflectorReturning(['manager']));
      expect(() => guard.canActivate(ctxWithUser('ghost'))).toThrow(
        ForbiddenException,
      );
    });

    it('rejects when there is no authenticated user', () => {
      const guard = new RolesGuard(reflectorReturning(['staff']));
      expect(() => guard.canActivate(ctxWithUser(undefined))).toThrow(
        ForbiddenException,
      );
    });
  });
});
