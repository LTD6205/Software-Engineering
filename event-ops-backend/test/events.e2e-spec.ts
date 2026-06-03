import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TestingModule } from '@nestjs/testing';
import { ACCOUNTS, auth, createTestApp, login } from './utils';

// Event permissions over HTTP: only eventmanager/admin may create/edit/delete
// events and manage members; manager/staff are forbidden. GET /events is scoped
// to the viewer's membership.
describe('Event permissions (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  let emToken: string; // eventmanager (creator)
  let managerToken: string; // a plain manager (forbidden from writes)
  let staffToken: string;
  let adminToken: string;

  let manager01Id: string; // a real manager user_id to add as a member
  let createdEventId: string;

  const eventBody = () => ({
    event_name: `E2E Test Event ${Date.now()}`,
    description: 'created by the events e2e spec',
    start_time: '2026-09-01T09:00:00.000Z',
    end_time: '2026-09-02T18:00:00.000Z',
  });

  beforeAll(async () => {
    ({ app, moduleRef } = await createTestApp());
    emToken = await login(app, ACCOUNTS.eventmanager);
    managerToken = await login(app, ACCOUNTS.manager);
    staffToken = await login(app, ACCOUNTS.staff);
    adminToken = await login(app, ACCOUNTS.admin);

    // Resolve manager01's user_id from the available-managers list.
    const res = await request(app.getHttpServer())
      .get('/api/events/available-managers')
      .set(auth(emToken));
    const m = (res.body as Array<{ user_id: string; email: string }>).find(
      (x) => x.email === ACCOUNTS.manager.email,
    );
    manager01Id = m!.user_id;
  });

  afterAll(async () => {
    // Clean up whatever event this spec created so the test DB stays tidy.
    if (createdEventId) {
      await request(app.getHttpServer())
        .delete(`/api/events/${createdEventId}`)
        .set(auth(emToken));
    }
    await app.close();
    await moduleRef.close();
  });

  describe('create (@Roles("eventmanager"))', () => {
    it('forbids a plain manager (403)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/events')
        .set(auth(managerToken))
        .send(eventBody());
      expect(res.status).toBe(403);
    });

    it('forbids staff (403)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/events')
        .set(auth(staffToken))
        .send(eventBody());
      expect(res.status).toBe(403);
    });

    it('lets an eventmanager create an event (201) with manager01 as a member', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/events')
        .set(auth(emToken))
        .send({ ...eventBody(), manager_ids: [manager01Id] });
      expect(res.status).toBe(201);
      expect(res.body.event_id).toBeDefined();
      createdEventId = res.body.event_id;

      // The added manager shows up in the membership list.
      const mgrs = await request(app.getHttpServer())
        .get(`/api/events/${createdEventId}/managers`)
        .set(auth(emToken));
      expect(
        (mgrs.body as Array<{ user_id: string }>).map((x) => x.user_id),
      ).toContain(manager01Id);
    });

    it('rejects an invalid date range (end before start) with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/events')
        .set(auth(emToken))
        .send({
          event_name: 'Bad dates',
          start_time: '2026-09-02T10:00:00.000Z',
          end_time: '2026-09-01T10:00:00.000Z',
        });
      expect(res.status).toBe(400);
    });
  });

  describe('update / member management', () => {
    it('forbids a manager from editing the event (403)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/events/${createdEventId}`)
        .set(auth(managerToken))
        .send({ description: 'hacked by a manager' });
      expect(res.status).toBe(403);
    });

    it('lets the eventmanager edit the event (200)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/events/${createdEventId}`)
        .set(auth(emToken))
        .send({ description: 'updated by the eventmanager' });
      expect(res.status).toBe(200);
      expect(res.body.description).toBe('updated by the eventmanager');
    });

    it('forbids a manager from removing a member (403)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/events/${createdEventId}/managers/${manager01Id}`)
        .set(auth(managerToken));
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/events scoping by viewer role', () => {
    it('an eventmanager sees the created event', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/events')
        .set(auth(emToken));
      const ids = (res.body as Array<{ event_id: string }>).map(
        (e) => e.event_id,
      );
      expect(ids).toContain(createdEventId);
    });

    it('the member manager (manager01) sees the event they belong to', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/events')
        .set(auth(managerToken));
      const ids = (res.body as Array<{ event_id: string }>).map(
        (e) => e.event_id,
      );
      expect(ids).toContain(createdEventId);
    });

    it('admin sees all events including this one', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/events')
        .set(auth(adminToken));
      const ids = (res.body as Array<{ event_id: string }>).map(
        (e) => e.event_id,
      );
      expect(ids).toContain(createdEventId);
    });
  });

  describe('delete (@Roles("eventmanager"))', () => {
    it('forbids a manager from deleting the event (403)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/events/${createdEventId}`)
        .set(auth(managerToken));
      expect(res.status).toBe(403);
    });
    // The successful delete happens in afterAll cleanup (by the eventmanager).
  });
});
