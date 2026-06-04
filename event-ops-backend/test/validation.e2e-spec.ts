import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { createTestApp, login, auth, ACCOUNTS } from './utils';

// Verifies the global ValidationPipe + ParseUUIDPipe reject bad input with 400
// instead of letting it reach services / the database.
describe('Input validation (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let managerToken: string;

  beforeAll(async () => {
    ({ app, moduleRef } = await createTestApp());
    managerToken = await login(app, ACCOUNTS.manager);
  });

  afterAll(async () => {
    await app.close();
    await moduleRef.close();
  });

  it('rejects a login missing the password field (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'someone@eventops.com' });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed UUID path param (400)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/users/not-a-uuid')
      .set(auth(managerToken));
    expect(res.status).toBe(400);
  });

  it('rejects an AI command with a non-UUID eventId (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ai/command')
      .set(auth(managerToken))
      .send({ eventId: 'nope', message: 'hi' });
    expect(res.status).toBe(400);
  });
});
