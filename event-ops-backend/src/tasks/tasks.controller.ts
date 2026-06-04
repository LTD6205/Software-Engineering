import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  ParseUUIDPipe,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { Task } from '../entities/task.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/jwt.strategy';
import { CreateTaskDto } from './dto/create-task.dto';

@Controller('tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get('event/:eventId')
  findByEvent(
    @Request() req: { user: JwtPayload },
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.tasksService.findAllByEvent(eventId, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  // ── Task groups (merged tasks). Declared before :id routes so the literal
  // "groups" segment is never swallowed by a param route. ──
  @Post('groups/merge')
  @Roles('manager')
  merge(
    @Request() req: { user: JwtPayload },
    @Body() body: { source_id: string; target_id: string },
  ) {
    return this.tasksService.merge(body.source_id, body.target_id, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  @Post('groups/:groupId/add')
  @Roles('manager')
  addToGroup(
    @Request() req: { user: JwtPayload },
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() body: { task_id: string },
  ) {
    return this.tasksService.addToGroup(groupId, body.task_id, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  @Put('groups/:groupId')
  @Roles('manager')
  renameGroup(
    @Request() req: { user: JwtPayload },
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() body: { title: string },
  ) {
    return this.tasksService.renameGroup(groupId, body.title, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  @Delete('groups/tasks/:taskId')
  @Roles('manager')
  ungroup(
    @Request() req: { user: JwtPayload },
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ) {
    return this.tasksService.ungroup(taskId, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  @Get(':id')
  findOne(
    @Request() req: { user: JwtPayload },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tasksService.findOneForViewer(id, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  @Post()
  @Roles('manager')
  create(@Request() req: { user: JwtPayload }, @Body() body: CreateTaskDto) {
    // created_by and event membership are enforced from the verified JWT, not
    // the request body. DTO dates arrive as ISO strings → coerce to Date.
    const { start_time, deadline, ...rest } = body;
    return this.tasksService.create(
      {
        ...rest,
        start_time: start_time ? new Date(start_time) : undefined,
        deadline: deadline ? new Date(deadline) : undefined,
      },
      { sub: req.user.sub, role: req.user.role },
    );
  }

  @Put(':id')
  update(
    @Request() req: { user: JwtPayload },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Partial<Task> & { actor_user_id?: string },
  ) {
    // The actor is taken from the verified JWT (not the spoofable body field);
    // actor_user_id isn't a Task column so it's dropped from the update data.
    const data: Partial<Task> & { actor_user_id?: string } = { ...body };
    delete data.actor_user_id;
    return this.tasksService.update(id, data, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  @Delete(':id')
  @Roles('manager')
  remove(
    @Request() req: { user: JwtPayload },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tasksService.remove(id, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  // Assignments
  @Get(':id/assignments')
  getAssignments(
    @Request() req: { user: JwtPayload },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tasksService.getAssignmentsForViewer(id, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  // Replace the whole assignee set (one or many staff) in a single call.
  @Put(':id/assignments')
  @Roles('manager')
  setAssignees(
    @Request() req: { user: JwtPayload },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { user_ids: string[] },
  ) {
    return this.tasksService.setAssignees(id, body.user_ids ?? [], {
      sub: req.user.sub,
      role: req.user.role,
    });
  }
}
