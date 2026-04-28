import { Controller, Get, Put, Param } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
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