import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('command')
  @Roles('manager')
  async processCommand(
    @Body() body: { userId: string; eventId: string; message: string },
  ): Promise<object> {
    return this.aiService.processCommand(
      body.userId,
      body.eventId,
      body.message,
    );
  }
}
