import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtPayload } from './jwt.strategy';

// Role hierarchy: Admin > Manager > Staff. A higher level can do everything a
// lower level can, so @Roles('manager') allows managers AND admins.
export const ROLE_LEVELS: Record<string, number> = {
  staff: 1,
  manager: 2,
  admin: 3,
};

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
    const userLevel = user ? (ROLE_LEVELS[user.role] ?? 0) : 0;
    const requiredLevel = Math.min(
      ...requiredRoles.map((r) => ROLE_LEVELS[r] ?? 99),
    );

    if (userLevel < requiredLevel) {
      throw new ForbiddenException(
        'You do not have permission to perform this action / Bạn không có quyền thực hiện hành động này',
      );
    }
    return true;
  }
}
