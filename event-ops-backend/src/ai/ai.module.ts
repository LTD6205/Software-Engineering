import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiRequest } from '../entities/ai-request.entity';
import { AiTaskMap } from '../entities/ai-task-map.entity';
import { User } from '../entities/user.entity';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { TasksModule } from '../tasks/tasks.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiRequest, AiTaskMap, User]),
    TasksModule,
    EventsModule,
  ],
  providers: [AiService],
  controllers: [AiController],
})
export class AiModule {}
