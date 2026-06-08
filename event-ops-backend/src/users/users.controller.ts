import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  ParseUUIDPipe,
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
import {
  CreateUserDto,
  UpdateUserDto,
  UpdateProfileDto,
  ReassignDto,
} from './dto/user.dto';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // GET /api/users — a manager sees their own staff + peer managers; an admin
  // sees the full roster (with active status).
  @Get()
  @Roles('manager', 'admin')
  findAll(@Request() req: { user: JwtPayload }) {
    return this.usersService.findAll({
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  // GET /api/users/directory — any signed-in user (online/presence board).
  // Must be declared before :id so it isn't captured as an id.
  @Get('directory')
  directory(@Request() req: { user: JwtPayload }) {
    return this.usersService.directory({
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  // GET /api/users/reassign-requests — staff reassignment requests addressed to
  // me (I am the proposed new manager). Declared before :id.
  @Get('reassign-requests')
  @Roles('manager', 'admin')
  reassignRequests(@Request() req: { user: JwtPayload }) {
    return this.usersService.incomingReassignRequests(req.user.sub);
  }

  // GET /api/users/:id — admins see anyone; a manager only their own staff, a
  // peer manager, or themselves (so a raw id can't read an arbitrary user).
  @Get(':id')
  @Roles('manager', 'admin')
  findOne(
    @Request() req: { user: JwtPayload },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.usersService.findOneForViewer(id, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  // POST /api/users/join-request — a teamless staff member asks to join a
  // manager's team (the manager must then accept). Declared before the :id
  // routes so "join-request" isn't parsed as an id.
  @Post('join-request')
  @Roles('staff')
  requestJoin(
    @Request() req: { user: JwtPayload },
    @Body() body: ReassignDto,
  ) {
    return this.usersService.requestJoin(body.target_manager_id, req.user);
  }

  // POST /api/users/join-request/cancel — the staff member withdraws their own
  // pending join request.
  @Post('join-request/cancel')
  @Roles('staff')
  cancelJoinRequest(@Request() req: { user: JwtPayload }) {
    return this.usersService.cancelReassign(req.user.sub, req.user);
  }

  // POST /api/users/:id/reassign — owner manager proposes moving a staff member
  // to another manager (target must then accept).
  @Post(':id/reassign')
  @Roles('manager', 'admin')
  reassign(
    @Request() req: { user: JwtPayload },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReassignDto,
  ) {
    return this.usersService.requestReassign(
      id,
      body.target_manager_id,
      req.user,
    );
  }

  // POST /api/users/:id/reassign/accept — target manager accepts the request.
  @Post(':id/reassign/accept')
  @Roles('manager', 'admin')
  acceptReassign(
    @Request() req: { user: JwtPayload },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.usersService.acceptReassign(id, req.user);
  }

  // POST /api/users/:id/reassign/reject — target manager rejects the request.
  @Post(':id/reassign/reject')
  @Roles('manager', 'admin')
  rejectReassign(
    @Request() req: { user: JwtPayload },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.usersService.rejectReassign(id, req.user);
  }

  // POST /api/users/:id/reassign/cancel — requesting owner manager withdraws a
  // pending request before the target manager has accepted or rejected it.
  @Post(':id/reassign/cancel')
  @Roles('manager', 'admin')
  cancelReassign(
    @Request() req: { user: JwtPayload },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.usersService.cancelReassign(id, req.user);
  }

  // POST /api/users/:id/remove-from-team — owner manager (or admin) removes a
  // staff member from their team: the account stays active but becomes teamless.
  @Post(':id/remove-from-team')
  @Roles('manager', 'admin')
  removeFromTeam(
    @Request() req: { user: JwtPayload },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.usersService.removeFromTeam(id, req.user);
  }

  // POST /api/users — manager creates staff; only admin creates non-staff roles
  @Post()
  @Roles('manager', 'admin')
  create(@Request() req: { user: JwtPayload }, @Body() body: CreateUserDto) {
    this.assertCanAssignRole(req.user.role, body.role);
    return this.usersService.create(body, req.user);
  }

  // PUT /api/users/me — any signed-in user edits their own profile.
  // Declared before :id so "me" isn't treated as an id.
  @Put('me')
  updateProfile(
    @Request() req: { user: JwtPayload },
    @Body() body: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(req.user.sub, body);
  }

  // PUT /api/users/:id — manager updates their own staff; only admin sets roles,
  // resets passwords, or (de)activates accounts.
  @Put(':id')
  @Roles('manager', 'admin')
  update(
    @Request() req: { user: JwtPayload },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserDto,
  ) {
    this.assertCanAssignRole(req.user.role, body.role);
    // Activating/deactivating an account is admin-only.
    if (body.is_active !== undefined && req.user.role !== 'admin') {
      throw new ForbiddenException(
        'Only an admin can activate or deactivate accounts / Chỉ quản trị viên mới có thể kích hoạt hoặc vô hiệu hóa tài khoản',
      );
    }
    return this.usersService.update(id, body, req.user);
  }

  // Only an admin may grant any non-staff role. A plain manager may only create
  // staff — never a peer manager, an organizer, or an admin.
  private assertCanAssignRole(actorRole: string, targetRole?: string) {
    if (!targetRole || actorRole === 'admin') return;
    if (targetRole !== 'staff') {
      throw new ForbiddenException(
        'Only an admin can assign a non-staff role / Chỉ quản trị viên mới có thể cấp vai trò ngoài nhân viên',
      );
    }
  }
}
