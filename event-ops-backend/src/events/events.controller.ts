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
import { EventsService } from './events.service';
import { Event } from '../entities/event.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/jwt.strategy';

@Controller('events')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  // Visible events for the current user (role-scoped), with headcounts.
  @Get()
  findAll(@Request() req: { user: JwtPayload }) {
    return this.eventsService.findForViewer({
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  // Managers an event manager can add to an event (with team sizes).
  @Get('available-managers')
  @Roles('eventmanager')
  availableManagers() {
    return this.eventsService.availableManagers();
  }

  @Get(':id/managers')
  getEventManagers(@Param('id') id: string) {
    return this.eventsService.getEventManagers(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.eventsService.findOne(id);
  }

  // Only event managers (and admins) create events.
  @Post()
  @Roles('eventmanager')
  create(
    @Request() req: { user: JwtPayload },
    @Body() body: Partial<Event> & { manager_ids?: string[] },
  ) {
    const { manager_ids, ...data } = body;
    return this.eventsService.create(
      { ...data, created_by: req.user.sub },
      manager_ids ?? [],
    );
  }

  @Put(':id')
  @Roles('eventmanager')
  update(@Param('id') id: string, @Body() body: Partial<Event>) {
    return this.eventsService.update(id, body);
  }

  @Delete(':id')
  @Roles('eventmanager')
  remove(@Param('id') id: string) {
    return this.eventsService.remove(id);
  }

  @Post(':id/managers')
  @Roles('eventmanager')
  addManager(@Param('id') id: string, @Body() body: { manager_id: string }) {
    return this.eventsService.addManager(id, body.manager_id);
  }

  @Delete(':id/managers/:managerId')
  @Roles('eventmanager')
  removeManager(
    @Param('id') id: string,
    @Param('managerId') managerId: string,
  ) {
    return this.eventsService.removeManager(id, managerId);
  }
}
