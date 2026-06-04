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
import { EventsService } from './events.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/jwt.strategy';
import {
  CreateEventDto,
  UpdateDatesDto,
  UpdateEventDto,
} from './dto/event.dto';

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

  // Managers an organizer can add to an event (with team sizes).
  @Get('available-managers')
  @Roles('organizer')
  availableManagers() {
    return this.eventsService.availableManagers();
  }

  @Get(':id/managers')
  getEventManagers(
    @Request() req: { user: JwtPayload },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.eventsService.getEventManagersForViewer(id, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  @Get(':id')
  findOne(
    @Request() req: { user: JwtPayload },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.eventsService.findOneForViewer(id, {
      sub: req.user.sub,
      role: req.user.role,
    });
  }

  // Only organizers (and admins) create events.
  @Post()
  @Roles('organizer')
  create(@Request() req: { user: JwtPayload }, @Body() body: CreateEventDto) {
    // DTO dates arrive as ISO strings → coerce to Date for the entity.
    const { manager_ids, start_time, end_time, ...data } = body;
    return this.eventsService.create(
      {
        ...data,
        start_time: new Date(start_time),
        end_time: new Date(end_time),
        created_by: req.user.sub,
      },
      manager_ids ?? [],
    );
  }

  // Edit name/description only. Dates are handled by PUT /events/:id/dates so
  // task shift/delete logic isn't bypassed; server-owned fields are never
  // accepted (UpdateEventDto + global whitelist strip anything else).
  @Put(':id')
  @Roles('organizer')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateEventDto) {
    return this.eventsService.update(id, body);
  }

  // Change an event's dates, choosing whether to delete or shift its tasks.
  @Put(':id/dates')
  @Roles('organizer')
  updateDates(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDatesDto,
  ) {
    return this.eventsService.updateDates(
      id,
      body.start_time,
      body.end_time,
      body.task_strategy === 'delete' ? 'delete' : 'shift',
    );
  }

  @Delete(':id')
  @Roles('organizer')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventsService.remove(id);
  }

  @Post(':id/managers')
  @Roles('organizer')
  addManager(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { manager_id: string },
  ) {
    return this.eventsService.addManager(id, body.manager_id, true);
  }

  @Delete(':id/managers/:managerId')
  @Roles('organizer')
  removeManager(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('managerId', ParseUUIDPipe) managerId: string,
  ) {
    return this.eventsService.removeManager(id, managerId);
  }
}
