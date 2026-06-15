import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from '../entities/task.entity';
import { TaskAssignment } from '../entities/task-assignment.entity';
import { TaskGroup } from '../entities/task-group.entity';
import { TaskLog } from '../entities/task-log.entity';
import { TaskChangeLog } from '../entities/task-change-log.entity';
import { User } from '../entities/user.entity';
import { Event } from '../entities/event.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { WebsocketModule } from '../websocket/websocket.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Task,
      TaskAssignment,
      TaskGroup,
      TaskLog,
      TaskChangeLog,
      User,
      Event,
    ]),
    WebsocketModule,
    NotificationsModule,
    forwardRef(() => EventsModule),
  ],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
