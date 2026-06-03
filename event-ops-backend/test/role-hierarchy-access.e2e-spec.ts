import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { ACCOUNTS, auth, createTestApp, login } from './utils';

// REGRESSION TEST for the RBAC fix (exact role match, no level hierarchy).
//
// Previously RolesGuard was level-based, so an Organizer (formerly "level 3")
// could reach Manager-only routes. The guard now uses EXACT role matching with
// `admin` as the only superuser, so:
//   • Organizer is DENIED (403) on Manager-only routes (@Roles('manager') /
//     @Roles('manager','admin')) — UI hiding is now backed by a real boundary.
//   • Manager is DENIED (403) on Organizer-only routes (@Roles('organizer')).
//   • Each role keeps its OWN routes; admin keeps everything (superuser).
describe('Role boundaries: exact-match RBAC (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let ds: DataSource;

  let emToken: string; // organizer01
  let managerToken: string; // manager01
  let adminToken: string; // admin01
  let staffToken: string; // staff01
  let managerId: string;
  let staffId: string;
  let adminId: string;

  const createdEventIds: string[] = [];

  const idByEmail = async (email: string): Promise<string> => {
    const rows: Array<{ user_id: string }> = await ds.query(
      'SELECT user_id FROM users WHERE email = $1',
      [email],
    );
    return rows[0].user_id;
  };

  const newEvent = () => ({
    event_name: `RBAC probe ${Date.now()}-${Math.round(performance.now())}`,
    start_time: '2026-12-01T09:00:00.000Z',
    end_time: '2026-12-10T18:00:00.000Z',
  });

  // Create an event (as the organizer) to host the task-write tests.
  const makeHostEvent = async (): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/events')
      .set(auth(emToken))
      .send(newEvent());
    createdEventIds.push(res.body.event_id);
    return res.body.event_id;
  };

  let hostEventId: string;

  beforeAll(async () => {
    ({ app, moduleRef } = await createTestApp());
    ds = moduleRef.get(DataSource, { strict: false });
    emToken = await login(app, ACCOUNTS.organizer);
    managerToken = await login(app, ACCOUNTS.manager);
    adminToken = await login(app, ACCOUNTS.admin);
    staffToken = await login(app, ACCOUNTS.staff);
    managerId = await idByEmail(ACCOUNTS.manager.email);
    staffId = await idByEmail(ACCOUNTS.staff.email);
    adminId = await idByEmail(ACCOUNTS.admin.email);

    // staff01 reports to manager01 so the manager may assign them.
    await ds.query(
      `UPDATE users SET manager_id = $1, pending_manager_id = NULL WHERE user_id = $2`,
      [managerId, staffId],
    );

    hostEventId = await makeHostEvent();
  });

  afterAll(async () => {
    // Delete every created event as admin (cascades their tasks).
    for (const id of createdEventIds) {
      await request(app.getHttpServer())
        .delete(`/api/events/${id}`)
        .set(auth(adminToken))
        .catch(() => undefined);
    }
    await app.close();
    await moduleRef.close();
  });

  describe('Organizer is DENIED Manager-only routes', () => {
    it('cannot create a task (POST /tasks → 403)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tasks')
        .set(auth(emToken))
        .send({ event_id: hostEventId, task_name: 'should be blocked' });
      expect(res.status).toBe(403);
    });

    it('cannot list users (GET /users → 403)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users')
        .set(auth(emToken));
      expect(res.status).toBe(403);
    });

    it('cannot create a staff account (POST /users → 403)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .set(auth(emToken))
        .send({
          name: 'blocked',
          email: `blocked-${Date.now()}@eventops.com`,
          password: 'x1234567',
          phone: '0900000098',
          role: 'staff',
        });
      expect(res.status).toBe(403);
    });

    it('cannot use the AI command (POST /ai/command → 403)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/ai/command')
        .set(auth(emToken))
        .send({ userId: 'x', eventId: hostEventId, message: 'blocked' });
      expect(res.status).toBe(403);
    });
  });

  describe('Manager keeps Manager-only routes', () => {
    let taskId: string;

    it('can create a task (POST /tasks → 201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tasks')
        .set(auth(managerToken))
        .send({
          event_id: hostEventId,
          task_name: 'Manager task',
          created_by: managerId,
        });
      expect(res.status).toBe(201);
      taskId = res.body.task_id;
    });

    it('can assign their staff (PUT /tasks/:id/assignments → 200)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/tasks/${taskId}/assignments`)
        .set(auth(managerToken))
        .send({ user_ids: [staffId] });
      expect(res.status).toBe(200);
    });

    it('can list users (GET /users → 200)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users')
        .set(auth(managerToken));
      expect(res.status).toBe(200);
    });

    it('is DENIED Organizer-only routes (POST /events → 403)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/events')
        .set(auth(managerToken))
        .send(newEvent());
      expect(res.status).toBe(403);
    });
  });

  describe('Organizer keeps its OWN routes', () => {
    it('can create an event (POST /events → 201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/events')
        .set(auth(emToken))
        .send(newEvent());
      expect(res.status).toBe(201);
      createdEventIds.push(res.body.event_id);
    });

    it('can list available managers (GET /events/available-managers → 200)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/events/available-managers')
        .set(auth(emToken));
      expect(res.status).toBe(200);
    });
  });

  describe('Admin remains the superuser', () => {
    it('can create a task (Manager-only route → 201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tasks')
        .set(auth(adminToken))
        .send({
          event_id: hostEventId,
          task_name: 'Admin task',
          created_by: adminId,
        });
      expect(res.status).toBe(201);
    });

    it('can create an event (Organizer route → 201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/events')
        .set(auth(adminToken))
        .send(newEvent());
      expect(res.status).toBe(201);
      createdEventIds.push(res.body.event_id);
    });
  });

  describe('Staff is denied everywhere it should be', () => {
    it('cannot create a task (403)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tasks')
        .set(auth(staffToken))
        .send({ event_id: hostEventId, task_name: 'nope' });
      expect(res.status).toBe(403);
    });

    it('cannot use the AI command (403)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/ai/command')
        .set(auth(staffToken))
        .send({ userId: staffId, eventId: hostEventId, message: 'nope' });
      expect(res.status).toBe(403);
    });
  });
});
