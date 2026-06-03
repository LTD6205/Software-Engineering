import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { User } from './entities/user.entity';
import { Event } from './entities/event.entity';
import { Task } from './entities/task.entity';
import { TaskLog } from './entities/task-log.entity';
import { TaskAssignment } from './entities/task-assignment.entity';
import { TaskDependency } from './entities/task-dependency.entity';
import { TaskGroup } from './entities/task-group.entity';
import { Notification } from './entities/notification.entity';
import { AiRequest } from './entities/ai-request.entity';
import { AiTaskMap } from './entities/ai-task-map.entity';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { EventsModule } from './events/events.module';
import { TasksModule } from './tasks/tasks.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AiModule } from './ai/ai.module';
import { WebsocketModule } from './websocket/websocket.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get('DB_USERNAME'),
        password: config.get('DB_PASSWORD'),
        database: config.get('DB_NAME'),
        entities: [
          User,
          Event,
          Task,
          TaskLog,
          TaskAssignment,
          TaskDependency,
          TaskGroup,
          Notification,
          AiRequest,
          AiTaskMap,
        ],
        synchronize: false,
      }),
    }),

    ScheduleModule.forRoot(),

    AuthModule,
    UsersModule,
    EventsModule,
    TasksModule,
    NotificationsModule,
    AiModule,
    WebsocketModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
