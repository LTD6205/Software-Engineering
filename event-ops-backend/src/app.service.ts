import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  // Lightweight liveness/health payload for the root route.
  health(): { status: string; service: string; timestamp: string } {
    return {
      status: 'ok',
      service: 'event-ops-backend',
      timestamp: new Date().toISOString(),
    };
  }
}
