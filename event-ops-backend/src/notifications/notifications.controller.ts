import {
  Controller,
  Get,
  Put,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt.strategy';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifsService: NotificationsService) {}

  // A user may only access their own notifications. The owner is taken from the
  // verified JWT, never trusted from the URL, so the :userId param can't be used
  // to read or clear someone else's notifications.
  private assertSelf(actorSub: string, userId: string) {
    if (actorSub !== userId) {
      throw new ForbiddenException(
        'You can only access your own notifications / Bạn chỉ có thể xem thông báo của mình',
      );
    }
  }

  @Get('user/:userId')
  getUnread(
    @Request() req: { user: JwtPayload },
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    this.assertSelf(req.user.sub, userId);
    return this.notifsService.getUnread(req.user.sub);
  }

  // Full history (read + unread). Declared before the bare :id-style routes.
  @Get('user/:userId/all')
  getAll(
    @Request() req: { user: JwtPayload },
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    this.assertSelf(req.user.sub, userId);
    return this.notifsService.getAll(
      req.user.sub,
      limit !== undefined ? Number(limit) : undefined,
      offset !== undefined ? Number(offset) : undefined,
    );
  }

  @Put('user/:userId/read-all')
  markAllRead(
    @Request() req: { user: JwtPayload },
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    this.assertSelf(req.user.sub, userId);
    return this.notifsService.markAllRead(req.user.sub);
  }

  // Scoped to the actor: a notification is only marked read if it belongs to
  // them (a foreign id is a harmless no-op rather than tampering another user's).
  @Put(':id/read')
  markRead(
    @Request() req: { user: JwtPayload },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifsService.markRead(id, req.user.sub);
  }
}
