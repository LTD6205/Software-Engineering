import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Server, Socket } from 'socket.io';

// Room every authenticated socket joins; presence goes only here so
// unauthenticated sockets never receive presence lists.
const AUTH_ROOM = 'authenticated';
// Admins and organizers can see every event, so instead of joining hundreds of
// per-event rooms they join this one; event broadcasts also target it.
const ALL_EVENTS_ROOM = 'events:all';

@WebSocketGateway({
  // Match the HTTP CORS origin instead of allowing every site to open a socket.
  cors: { origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3001' },
})
export class EventsGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // Presence tracking. A user may have several sockets open (multiple tabs),
  // so we count sockets per user and only treat a user as offline once the
  // last one disconnects.
  private socketToUser = new Map<string, string>();
  private onlineCounts = new Map<string, number>();

  // Frontend connects with the JWT in the handshake auth, then emits
  // 'register'. We derive the user id from the *verified* token rather than
  // trusting any client-supplied value, so presence cannot be spoofed.
  @SubscribeMessage('register')
  async handleRegister(@ConnectedSocket() client: Socket): Promise<void> {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      client.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

    let userId: string;
    let role: string;
    try {
      const payload = this.jwtService.verify<{ sub: string; role: string }>(
        token ?? '',
      );
      userId = payload.sub;
      role = payload.role;
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
    // Join the rooms for the events this user can see, so event/task broadcasts
    // only reach members. (Membership is fixed at connect time — a user added to
    // an event later still gets the per-user notification; they pick up live
    // event broadcasts on their next (re)connect.)
    await this.joinEventRooms(client, userId, role);
    this.socketToUser.set(client.id, userId);
    this.onlineCounts.set(userId, (this.onlineCounts.get(userId) ?? 0) + 1);

    // Send the current presence list to the new client, then tell everyone.
    client.emit('presence', this.getOnlineUserIds());
    this.broadcastPresence();
  }

  // Join the socket to the event rooms its user may view. Admins/organizers see
  // every event so they join the catch-all room instead of N per-event rooms.
  private async joinEventRooms(
    client: Socket,
    userId: string,
    role: string,
  ): Promise<void> {
    if (role === 'admin' || role === 'organizer') {
      void client.join(ALL_EVENTS_ROOM);
      return;
    }
    const sql =
      role === 'manager'
        ? `SELECT event_id FROM event_managers WHERE manager_id = $1`
        : `SELECT em.event_id FROM event_managers em
             WHERE em.manager_id = (SELECT manager_id FROM users WHERE user_id = $1)`;
    try {
      const rows: Array<{ event_id: string }> = await this.dataSource.query(
        sql,
        [userId],
      );
      for (const r of rows) void client.join(`event:${r.event_id}`);
    } catch {
      // If membership can't be resolved, the user simply won't get live event
      // broadcasts (they still get per-user notifications). Don't fail register.
    }
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

  // Broadcast to all authenticated users. Kept for any truly global signal; the
  // event/task data-change + celebration payloads use broadcastToEvent instead.
  broadcast(event: string, payload: object) {
    this.server.to(AUTH_ROOM).emit(event, payload);
  }

  // Emit an event/task payload only to members of that event (plus admins/
  // organizers via the catch-all room). Falls back to a global broadcast if no
  // event id is known.
  broadcastToEvent(eventId: string | undefined, event: string, payload: object) {
    if (!eventId) {
      this.broadcast(event, payload);
      return;
    }
    this.server.to(`event:${eventId}`).to(ALL_EVENTS_ROOM).emit(event, payload);
  }
}
