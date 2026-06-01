import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { Task } from '../entities/task.entity';
import { Milestone } from '../entities/milestone.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/jwt.strategy';

@Controller('tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get('event/:eventId')
  findByEvent(@Param('eventId') eventId: string) {
    return this.tasksService.findAllByEvent(eventId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tasksService.findOne(id);
  }

  @Post()
  @Roles('manager')
  create(@Body() body: Partial<Task>) {
    return this.tasksService.create(body);
  }

  @Put(':id')
  update(
    @Request() req: { user: JwtPayload },
    @Param('id') id: string,
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

  // Assignments
  @Get(':id/assignments')
  getAssignments(@Param('id') id: string) {
    return this.tasksService.getAssignments(id);
  }

  @Post(':id/assign')
  @Roles('manager')
  assign(@Param('id') id: string, @Body() body: { user_id: string }) {
    return this.tasksService.assignUser(id, body.user_id);
  }

  @Delete(':id/assign/:userId')
  @Roles('manager')
  unassign(@Param('id') id: string, @Param('userId') userId: string) {
    return this.tasksService.unassignUser(id, userId);
  }

  // Milestones
  @Get(':id/milestones')
  getMilestones(@Param('id') id: string) {
    return this.tasksService.getMilestones(id);
  }

  @Post(':id/milestones')
  @Roles('manager')
  addMilestone(@Param('id') id: string, @Body() body: Partial<Milestone>) {
    return this.tasksService.addMilestone(id, body);
  }

  @Put('milestones/:milestoneId/complete')
  @Roles('manager')
  completeMilestone(@Param('milestoneId') milestoneId: string) {
    return this.tasksService.completeMilestone(milestoneId);
  }
}
