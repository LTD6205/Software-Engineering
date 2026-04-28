import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' } })
export class EventsGateway {
  @WebSocketServer()
  server!: Server;

  // Frontend calls: socket.emit('register', { userId })
  @SubscribeMessage('register')
  handleRegister(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`user:${data.userId}`);
  }

  // Called internally by NotificationsService to push to one user
  sendToUser(userId: string, payload: object) {
    this.server.to(`user:${userId}`).emit('notification', payload);
  }

  // Broadcast to all connected users
  broadcast(event: string, payload: object) {
    this.server.emit(event, payload);
  }
}