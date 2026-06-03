import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TestingModule } from '@nestjs/testing';
import { ACCOUNTS, auth, createTestApp, login } from './utils';

// End-to-end against the real (test) Postgres: JWT login, the JwtAuthGuard, and
// the RolesGuard level hierarchy enforced over HTTP.
describe('Auth & roles (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    ({ app, moduleRef } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
    await moduleRef.close();
  });

  describe('POST /api/auth/login', () => {
    it('returns a JWT and a sanitized user for valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send(ACCOUNTS.manager);
      expect(res.status).toBe(201);
      expect(typeof res.body.access_token).toBe('string');
      expect(res.body.user.email).toBe(ACCOUNTS.manager.email);
      expect(res.body.user.role).toBe('manager');
      expect(res.body.user).not.toHaveProperty('password_hash');
    });

    it('rejects a wrong password with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: ACCOUNTS.manager.email, password: 'nope' });
      expect(res.status).toBe(401);
    });

    it('rejects an unknown email with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'ghost@nowhere.com', password: 'x' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/me (JwtAuthGuard)', () => {
    it('rejects a request with no token (401)', async () => {
      const res = await request(app.getHttpServer()).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('rejects a malformed/garbage token (401)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set(auth('not.a.real.token'));
      expect(res.status).toBe(401);
    });

    it('returns the current user for a valid token', async () => {
      const token = await login(app, ACCOUNTS.eventmanager);
      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set(auth(token));
      expect(res.status).toBe(200);
      expect(res.body.email).toBe(ACCOUNTS.eventmanager.email);
      expect(res.body).not.toHaveProperty('password_hash');
    });
  });

  // GET /api/events/available-managers carries @Roles('eventmanager'), so it is
  // a clean probe of the RolesGuard's EXACT role matching: only event managers
  // (and admin, the superuser) may pass — managers/staff are denied.
  describe('RolesGuard exact match (via @Roles("eventmanager") route)', () => {
    it('forbids staff (403)', async () => {
      const token = await login(app, ACCOUNTS.staff);
      const res = await request(app.getHttpServer())
        .get('/api/events/available-managers')
        .set(auth(token));
      expect(res.status).toBe(403);
    });

    it('forbids manager — not an event manager (403)', async () => {
      const token = await login(app, ACCOUNTS.manager);
      const res = await request(app.getHttpServer())
        .get('/api/events/available-managers')
        .set(auth(token));
      expect(res.status).toBe(403);
    });

    it('allows eventmanager (200)', async () => {
      const token = await login(app, ACCOUNTS.eventmanager);
      const res = await request(app.getHttpServer())
        .get('/api/events/available-managers')
        .set(auth(token));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('allows admin — the superuser is allowed on every role-guarded route (200)', async () => {
      const token = await login(app, ACCOUNTS.admin);
      const res = await request(app.getHttpServer())
        .get('/api/events/available-managers')
        .set(auth(token));
      expect(res.status).toBe(200);
    });
  });

  // GET /api/events has no @Roles → any authenticated user may read (role-scoped).
  describe('an unguarded-by-role read route still requires authentication', () => {
    it('401 without a token', async () => {
      const res = await request(app.getHttpServer()).get('/api/events');
      expect(res.status).toBe(401);
    });

    it('200 for any authenticated role (staff)', async () => {
      const token = await login(app, ACCOUNTS.staff);
      const res = await request(app.getHttpServer())
        .get('/api/events')
        .set(auth(token));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
