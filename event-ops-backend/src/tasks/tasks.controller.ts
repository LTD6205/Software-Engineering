import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { TasksService } from './tasks.service';

@Controller('tasks')
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
  create(@Body() body: any) {
    return this.tasksService.create(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.tasksService.update(id, body, body.actor_user_id);
  }

  // Assignments
  @Get(':id/assignments')
  getAssignments(@Param('id') id: string) {
    return this.tasksService.getAssignments(id);
  }

  @Post(':id/assign')
  assign(@Param('id') id: string, @Body() body: { user_id: string }) {
    return this.tasksService.assignUser(id, body.user_id);
  }

  @Delete(':id/assign/:userId')
  unassign(@Param('id') id: string, @Param('userId') userId: string) {
    return this.tasksService.unassignUser(id, userId);
  }

  // Milestones
  @Get(':id/milestones')
  getMilestones(@Param('id') id: string) {
    return this.tasksService.getMilestones(id);
  }

  @Post(':id/milestones')
  addMilestone(@Param('id') id: string, @Body() body: any) {
    return this.tasksService.addMilestone(id, body);
  }

  @Put('milestones/:milestoneId/complete')
  completeMilestone(@Param('milestoneId') milestoneId: string) {
    return this.tasksService.completeMilestone(milestoneId);
  }
}