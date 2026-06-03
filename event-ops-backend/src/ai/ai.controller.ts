import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/jwt.strategy';

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('command')
  @Roles('manager')
  async processCommand(
    @Request() req: { user: JwtPayload },
    // Only eventId and message come from the body. The acting user is taken
    // from the verified JWT, never from a client-supplied userId.
    @Body() body: { eventId: string; message: string },
  ): Promise<object> {
    return this.aiService.processCommand(
      { sub: req.user.sub, role: req.user.role },
      body.eventId,
      body.message,
    );
  }
}
