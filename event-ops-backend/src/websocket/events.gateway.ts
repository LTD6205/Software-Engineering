import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

// Room every authenticated socket joins; presence and data-change broadcasts go
// only here so unauthenticated sockets never receive presence lists or event/
// task payloads.
const AUTH_ROOM = 'authenticated';

@WebSocketGateway({
  // Match the HTTP CORS origin instead of allowing every site to open a socket.
  cors: { origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3001' },
})
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
      // Unauthenticated socket — drop it rather than leaving it connected.
      client.disconnect();
      return;
    }
    if (!userId) {
      client.disconnect();
      return;
    }

    // Ignore a repeat 'register' for an already-counted socket, otherwise a
    // client emitting register twice would inflate its online count and stay
    // "online" after disconnect (which only decrements once).
    if (this.socketToUser.get(client.id) === userId) {
      client.emit('presence', this.getOnlineUserIds());
      return;
    }
    // If this socket was registered as a different user, undo that first.
    const previous = this.socketToUser.get(client.id);
    if (previous) this.decrement(previous);

    void client.join(`user:${userId}`);
    void client.join(AUTH_ROOM);
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
    this.decrement(userId);
    this.broadcastPresence();
  }

  // Drop one socket from a user's online count, clearing them when it hits 0.
  private decrement(userId: string): void {
    const remaining = (this.onlineCounts.get(userId) ?? 1) - 1;
    if (remaining <= 0) this.onlineCounts.delete(userId);
    else this.onlineCounts.set(userId, remaining);
  }

  getOnlineUserIds(): string[] {
    return Array.from(this.onlineCounts.keys());
  }

  private broadcastPresence(): void {
    // Only authenticated sockets receive the presence list.
    this.server.to(AUTH_ROOM).emit('presence', this.getOnlineUserIds());
  }

  // Called internally by NotificationsService to push to one user
  sendToUser(userId: string, payload: object) {
    this.server.to(`user:${userId}`).emit('notification', payload);
  }

  // Broadcast to all authenticated users (data-change / celebration events).
  broadcast(event: string, payload: object) {
    this.server.to(AUTH_ROOM).emit(event, payload);
  }
}
