import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { Task } from '../entities/task.entity';
import { Milestone } from '../entities/milestone.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

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
    @Param('id') id: string,
    @Body() body: Partial<Task> & { actor_user_id?: string },
  ) {
    return this.tasksService.update(id, body, body.actor_user_id);
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
