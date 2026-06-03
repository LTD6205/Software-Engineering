import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtPayload } from './jwt.strategy';

// Access control is by EXACT role match. A route's `@Roles(...)` list is an
// explicit allow-list of the roles permitted on it — there is NO level
// hierarchy and NO inheritance between roles. An Event Manager is NOT a Manager
// (and vice-versa): `@Roles('manager')` admits managers only, so an Event
// Manager cannot reach Manager-only endpoints (create tasks, manage staff, AI),
// and `@Roles('eventmanager')` admits event managers only.
//
// The single exception is `admin`, the system superuser, which is permitted on
// every role-guarded route. This mirrors the frontend's role flags
// (isManager = manager||admin, canManageEvents = eventmanager||admin, isAdmin).
export const ADMIN_ROLE = 'admin';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<string[]>(
      'roles',
      context.getHandler(),
    );
    // No @Roles on the handler → any authenticated user may proceed.
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const role = user?.role;

    // admin is the superuser; every other role must be listed explicitly
    // (exact match — no inheritance between roles).
    if (role && (role === ADMIN_ROLE || requiredRoles.includes(role))) {
      return true;
    }

    throw new ForbiddenException(
      'You do not have permission to perform this action / Bạn không có quyền thực hiện hành động này',
    );
  }
}
