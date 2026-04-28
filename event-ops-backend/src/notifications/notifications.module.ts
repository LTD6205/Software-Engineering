import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task }                     from '../entities/task.entity';
import { Notification }             from '../entities/notification.entity';
import { TaskAssignment }           from '../entities/task-assignment.entity';
import { NotificationsService }     from './notifications.service';
import { NotificationsController }  from './notifications.controller';
import { WebsocketModule }          from '../websocket/websocket.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, Notification, TaskAssignment]),
    WebsocketModule,
  ],
  providers: [NotificationsService],
  controllers: [NotificationsController],
})
export class NotificationsModule {}