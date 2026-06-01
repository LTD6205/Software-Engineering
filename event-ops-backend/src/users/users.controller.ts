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

  // GET /api/users — manager only
  @Get()
  @Roles('manager', 'admin')
  findAll() {
    return this.usersService.findAll();
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
      role?: string;
    },
  ) {
    this.assertCanAssignRole(req.user.role, body.role);
    return this.usersService.create(body);
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

  // PUT /api/users/:id/deactivate — manager deactivates staff
  @Put(':id/deactivate')
  @Roles('manager', 'admin')
  deactivate(@Param('id') id: string) {
    return this.usersService.deactivate(id);
  }
}
