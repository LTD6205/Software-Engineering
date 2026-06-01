import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' } })
export class EventsGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwtService: JwtService) {}

  // Presence tracking. A user may have several sockets open (multiple tabs),
  // so we count sockets per user and only treat a user as offline once the
  // last one disconnects.
  private socketToUser = new Map<string, string>();
  private onlineCounts = new Map<string, number>();

  // Frontend connects with the JWT in the handshake auth, then emits
  // 'register'. We derive the user id from the *verified* token rather than
  // trusting any client-supplied value, so presence cannot be spoofed.
  @SubscribeMessage('register')
  handleRegister(@ConnectedSocket() client: Socket): void {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      client.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

    let userId: string;
    try {
      const payload = this.jwtService.verify<{ sub: string }>(token ?? '');
      userId = payload.sub;
    } catch {
      return; // unauthenticated socket — ignore
    }
    if (!userId) return;

    void client.join(`user:${userId}`);
    this.socketToUser.set(client.id, userId);
    this.onlineCounts.set(userId, (this.onlineCounts.get(userId) ?? 0) + 1);

    // Send the current presence list to the new client, then tell everyone.
    client.emit('presence', this.getOnlineUserIds());
    this.broadcastPresence();
  }

  handleDisconnect(client: Socket): void {
    const userId = this.socketToUser.get(client.id);
    if (!userId) return;
    this.socketToUser.delete(client.id);

    const remaining = (this.onlineCounts.get(userId) ?? 1) - 1;
    if (remaining <= 0) this.onlineCounts.delete(userId);
    else this.onlineCounts.set(userId, remaining);

    this.broadcastPresence();
  }

  getOnlineUserIds(): string[] {
    return Array.from(this.onlineCounts.keys());
  }

  private broadcastPresence(): void {
    this.server.emit('presence', this.getOnlineUserIds());
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
