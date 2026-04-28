import { Controller, Post, Body } from '@nestjs/common';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('command')
  async processCommand(
    @Body() body: { userId: string; eventId: string; message: string },
  ): Promise<object> {
    return this.aiService.processCommand(body.userId, body.eventId, body.message);
  }
}