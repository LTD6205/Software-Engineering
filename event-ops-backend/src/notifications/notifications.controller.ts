import { Controller, Get, Put, Param, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifsService: NotificationsService) {}

  @Get('user/:userId')
  getUnread(@Param('userId') userId: string) {
    return this.notifsService.getUnread(userId);
  }

  @Put(':id/read')
  markRead(@Param('id') id: string) {
    return this.notifsService.markRead(id);
  }
}
