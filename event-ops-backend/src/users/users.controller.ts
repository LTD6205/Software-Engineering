import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/jwt.strategy';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // GET /api/users — manager only (admins additionally get active status)
  @Get()
  @Roles('manager', 'admin')
  findAll(@Request() req: { user: JwtPayload }) {
    return this.usersService.findAll(req.user.role);
  }

  // GET /api/users/directory — any signed-in user (online/presence board).
  // Must be declared before :id so it isn't captured as an id.
  @Get('directory')
  directory() {
    return this.usersService.directory();
  }

  // GET /api/users/:id — manager only
  @Get(':id')
  @Roles('manager', 'admin')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  // POST /api/users — manager creates staff/manager; only admin creates admin
  @Post()
  @Roles('manager', 'admin')
  create(
    @Request() req: { user: JwtPayload },
    @Body()
    body: {
      name: string;
      email: string;
      password: string;
      phone?: string;
      role?: string;
    },
  ) {
    this.assertCanAssignRole(req.user.role, body.role);
    return this.usersService.create(body);
  }

  // PUT /api/users/me — any signed-in user edits their own profile.
  // Declared before :id so "me" isn't treated as an id.
  @Put('me')
  updateProfile(
    @Request() req: { user: JwtPayload },
    @Body()
    body: {
      current_password: string;
      name?: string;
      email?: string;
      phone?: string;
      avatar?: string;
      new_password?: string;
    },
  ) {
    return this.usersService.updateProfile(req.user.sub, body);
  }

  // PUT /api/users/:id — manager updates staff; only admin sets admin role
  @Put(':id')
  @Roles('manager', 'admin')
  update(
    @Request() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      role?: string;
      is_active?: boolean;
      password?: string;
    },
  ) {
    this.assertCanAssignRole(req.user.role, body.role);
    // Activating/deactivating an account is admin-only.
    if (body.is_active !== undefined && req.user.role !== 'admin') {
      throw new ForbiddenException(
        'Only an admin can activate or deactivate accounts / Chỉ quản trị viên mới có thể kích hoạt hoặc vô hiệu hóa tài khoản',
      );
    }
    return this.usersService.update(id, body);
  }

  // Only an admin may grant the admin role.
  private assertCanAssignRole(actorRole: string, targetRole?: string) {
    if (targetRole === 'admin' && actorRole !== 'admin') {
      throw new ForbiddenException(
        'Only an admin can assign the admin role / Chỉ quản trị viên mới có thể cấp vai trò admin',
      );
    }
  }

  // PUT /api/users/:id/deactivate — admin only
  @Put(':id/deactivate')
  @Roles('admin')
  deactivate(@Param('id') id: string) {
    return this.usersService.deactivate(id);
  }
}
