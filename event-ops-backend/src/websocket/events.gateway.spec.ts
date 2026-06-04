import { EventsGateway } from './events.gateway';

function build() {
  const jwtService = { verify: jest.fn() };
  const dataSource = { query: jest.fn().mockResolvedValue([]) };
  const gateway = new EventsGateway(jwtService as never, dataSource as never);
  // socket.io server: `.to(room)` is chainable, `.emit(event, payload)` sends.
  const server = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
  (gateway as unknown as { server: unknown }).server = server;
  return { gateway, jwtService, dataSource, server };
}

function mockClient(token?: string) {
  return {
    id: 'sock1',
    handshake: { auth: { token }, headers: {} },
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
}

describe('EventsGateway', () => {
  describe('handleRegister', () => {
    it('disconnects a socket whose token is invalid', async () => {
      const { gateway, jwtService } = build();
      jwtService.verify.mockImplementation(() => {
        throw new Error('bad token');
      });
      const client = mockClient('garbage');
      await gateway.handleRegister(client as never);
      expect(client.disconnect).toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });

    it('joins a manager to their event rooms plus the user/auth rooms', async () => {
      const { gateway, jwtService, dataSource } = build();
      jwtService.verify.mockReturnValue({ sub: 'm1', role: 'manager' });
      dataSource.query.mockResolvedValue([
        { event_id: 'e1' },
        { event_id: 'e2' },
      ]);
      const client = mockClient('tok');
      await gateway.handleRegister(client as never);
      const joined = client.join.mock.calls.map((c) => c[0]);
      expect(joined).toEqual(
        expect.arrayContaining([
          'user:m1',
          'authenticated',
          'event:e1',
          'event:e2',
        ]),
      );
    });

    it('joins admins to the catch-all events room without per-event queries', async () => {
      const { gateway, jwtService, dataSource } = build();
      jwtService.verify.mockReturnValue({ sub: 'a1', role: 'admin' });
      const client = mockClient('tok');
      await gateway.handleRegister(client as never);
      expect(client.join.mock.calls.map((c) => c[0])).toContain('events:all');
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('scopes a staff member to the events their manager belongs to', async () => {
      const { gateway, jwtService, dataSource } = build();
      jwtService.verify.mockReturnValue({ sub: 's1', role: 'staff' });
      dataSource.query.mockResolvedValue([{ event_id: 'e9' }]);
      const client = mockClient('tok');
      await gateway.handleRegister(client as never);
      expect(dataSource.query.mock.calls[0][0]).toMatch(
        /manager_id = \(SELECT manager_id/,
      );
      expect(client.join.mock.calls.map((c) => c[0])).toContain('event:e9');
    });
  });

  describe('broadcastToEvent', () => {
    it('emits to the event room and the catch-all room', () => {
      const { gateway, server } = build();
      gateway.broadcastToEvent('e1', 'data_changed', { kind: 'task' });
      expect(server.to).toHaveBeenCalledWith('event:e1');
      expect(server.to).toHaveBeenCalledWith('events:all');
      expect(server.emit).toHaveBeenCalledWith('data_changed', { kind: 'task' });
    });

    it('falls back to a global authenticated broadcast when no event id', () => {
      const { gateway, server } = build();
      gateway.broadcastToEvent(undefined, 'celebrate', { kind: 'task' });
      expect(server.to).toHaveBeenCalledWith('authenticated');
      expect(server.emit).toHaveBeenCalledWith('celebrate', { kind: 'task' });
    });
  });

  // Room refresh when event membership changes — so an add/remove takes effect
  // on already-connected sockets without waiting for a reconnect (#2).
  describe('event room refresh', () => {
    function buildRoomGateway() {
      const gateway = new EventsGateway({} as never, {} as never);
      const joined: Array<{ from: string; room: string }> = [];
      const left: Array<{ from: string; room: string }> = [];
      const inMock = jest.fn((from: string) => ({
        socketsJoin: (room: string) => joined.push({ from, room }),
        socketsLeave: (room: string) => left.push({ from, room }),
      }));
      (gateway as unknown as { server: unknown }).server = { in: inMock };
      return { gateway, joined, left };
    }

    it('joins each user’s personal room to the event room', () => {
      const { gateway, joined } = buildRoomGateway();
      gateway.addUsersToEventRoom(['u1', 'u2'], 'e1');
      expect(joined).toEqual([
        { from: 'user:u1', room: 'event:e1' },
        { from: 'user:u2', room: 'event:e1' },
      ]);
    });

    it('removes each user’s personal room from the event room', () => {
      const { gateway, left } = buildRoomGateway();
      gateway.removeUsersFromEventRoom(['u1', 'u2'], 'e1');
      expect(left).toEqual([
        { from: 'user:u1', room: 'event:e1' },
        { from: 'user:u2', room: 'event:e1' },
      ]);
    });

    it('is a no-op without an event id, and skips blank user ids', () => {
      const { gateway, joined, left } = buildRoomGateway();
      gateway.addUsersToEventRoom(['u1'], undefined);
      gateway.removeUsersFromEventRoom(['u1'], undefined);
      gateway.addUsersToEventRoom(['', 'u1'], 'e1');
      expect(left).toHaveLength(0);
      expect(joined).toEqual([{ from: 'user:u1', room: 'event:e1' }]);
    });
  });
});
