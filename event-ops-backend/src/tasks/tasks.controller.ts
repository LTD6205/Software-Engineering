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
import {
  UpdateTaskDto,
  MergeTasksDto,
  AddToGroupDto,
  RenameGroupDto,
  SetAssigneesDto,
  BatchTaskIdsDto,
  CreateCustomStatusDto,
  LinkTaskDto,
} from './dto/task.dto';

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

  // ── Per-event undo history (the 3 most recent task changes) ──
  @Get('event/:eventId/changes')
  @Roles('manager')
  eventChanges(
    @Request() req: { user: JwtPayload },
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.tasksService.getEventChanges(eventId, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  @Post('event/:eventId/undo')
  @Roles('manager')
  undoLast(
    @Request() req: { user: JwtPayload },
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.tasksService.undoLastChange(eventId, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  // ── Batch actions on multiple selected tasks (one undoable operation) ──
  @Post('batch/delete')
  @Roles('manager')
  batchDelete(
    @Request() req: { user: JwtPayload },
    @Body() body: BatchTaskIdsDto,
  ) {
    return this.tasksService.removeMany(body.task_ids, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  @Post('batch/ungroup')
  @Roles('manager')
  batchUngroup(
    @Request() req: { user: JwtPayload },
    @Body() body: BatchTaskIdsDto,
  ) {
    return this.tasksService.ungroupMany(body.task_ids, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  // ── Task groups (merged tasks). Declared before :id routes so the literal
  // "groups" segment is never swallowed by a param route. ──
  @Post('groups/merge')
  @Roles('manager')
  merge(@Request() req: { user: JwtPayload }, @Body() body: MergeTasksDto) {
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
    @Body() body: AddToGroupDto,
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
    @Body() body: RenameGroupDto,
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

  // ── Custom statuses (reusable per-event progress labels). Declared before
  // :id routes so the literal segments aren't swallowed by a param route.
  // No @Roles: any event member may read/define; the service authorizes. ──
  @Get('event/:eventId/custom-statuses')
  listCustomStatuses(
    @Request() req: { user: JwtPayload },
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.tasksService.listCustomStatuses(eventId, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  @Post('event/:eventId/custom-statuses')
  createCustomStatus(
    @Request() req: { user: JwtPayload },
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() body: CreateCustomStatusDto,
  ) {
    return this.tasksService.createCustomStatus(eventId, body, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  @Delete('custom-statuses/:statusId')
  deleteCustomStatus(
    @Request() req: { user: JwtPayload },
    @Param('statusId', ParseUUIDPipe) statusId: string,
  ) {
    return this.tasksService.deleteCustomStatus(statusId, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  // ── Task links (symmetric "related" relationship). Managers and qualifying
  // staff may link; the service authorizes. ──
  @Get(':id/links')
  getLinks(
    @Request() req: { user: JwtPayload },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tasksService.getLinks(id, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  @Post(':id/links')
  linkTask(
    @Request() req: { user: JwtPayload },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: LinkTaskDto,
  ) {
    return this.tasksService.linkTasks(id, body.target_task_id, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  @Delete(':id/links/:targetId')
  unlinkTask(
    @Request() req: { user: JwtPayload },
    @Param('id', ParseUUIDPipe) id: string,
    @Param('targetId', ParseUUIDPipe) targetId: string,
  ) {
    return this.tasksService.unlinkTasks(id, targetId, {
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
    @Body() body: UpdateTaskDto,
  ) {
    // The actor is taken from the verified JWT (not the spoofable body field);
    // actor_user_id isn't a Task column so it's dropped. DTO dates arrive as ISO
    // strings → coerce to Date for the entity, only for the fields actually set.
    const { start_time, deadline, ...rest } = body;
    const data: Partial<Task> & { actor_user_id?: string } = { ...rest };
    delete data.actor_user_id;
    if (start_time !== undefined) data.start_time = new Date(start_time);
    if (deadline !== undefined) data.deadline = new Date(deadline);
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
    @Body() body: SetAssigneesDto,
  ) {
    return this.tasksService.setAssignees(id, body.user_ids ?? [], {
      sub: req.user.sub,
      role: req.user.role,
    });
  }
}
