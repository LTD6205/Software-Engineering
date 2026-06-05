import {
  Controller,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/jwt.strategy';
import { AiCommandDto } from './dto/ai-command.dto';

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('command')
  @Roles('organizer', 'manager', 'admin')
  async processCommand(
    @Request() req: { user: JwtPayload },
    @Body() body: AiCommandDto,
  ): Promise<object> {
    return this.aiService.processCommand(
      { sub: req.user.sub, role: req.user.role },
      {
        eventId: body.eventId,
        message: body.message,
        mode: body.mode,
        history: body.history,
      },
    );
  }

  @Post('command/:requestId/confirm')
  @Roles('organizer', 'manager', 'admin')
  async confirm(
    @Request() req: { user: JwtPayload },
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ): Promise<object> {
    return this.aiService.confirmCommand(
      { sub: req.user.sub, role: req.user.role },
      requestId,
    );
  }

  @Post('command/:requestId/cancel')
  @Roles('organizer', 'manager', 'admin')
  async cancel(
    @Request() req: { user: JwtPayload },
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ): Promise<object> {
    return this.aiService.cancelCommand(
      { sub: req.user.sub, role: req.user.role },
      requestId,
    );
  }
}
