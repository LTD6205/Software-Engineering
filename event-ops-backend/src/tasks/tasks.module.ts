import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from '../entities/task.entity';
import { TaskAssignment } from '../entities/task-assignment.entity';
import { TaskDependency } from '../entities/task-dependency.entity';
import { TaskLog } from '../entities/task-log.entity';
import { Milestone } from '../entities/milestone.entity';
import { User } from '../entities/user.entity';
import { Event } from '../entities/event.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Task,
      TaskAssignment,
      TaskDependency,
      TaskLog,
      Milestone,
      User,
      Event,
    ]),
    WebsocketModule,
  ],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
