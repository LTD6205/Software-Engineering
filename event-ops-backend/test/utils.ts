import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Seeded accounts (see seed.js). Passwords are fixed per role.
export const ACCOUNTS = {
  admin: { email: 'admin01@eventops.com', password: 'admin123' },
  eventmanager: {
    email: 'eventmanager01@eventops.com',
    password: 'eventmanager123',
  },
  manager: { email: 'manager01@eventops.com', password: 'manager123' },
  staff: { email: 'staff01@eventops.com', password: 'staff123' },
};

// Boot the full Nest app against the test DB, mirroring main.ts's global
// `/api` prefix so route paths match production.
export async function createTestApp(): Promise<{
  app: INestApplication;
  moduleRef: TestingModule;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  // logger: false keeps e2e output clean — e.g. the AI route's expected
  // DeepSeek failure (no API key in tests) would otherwise dump a stack trace.
  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  await app.init();
  return { app, moduleRef };
}

// Log in and return the JWT access token.
export async function login(
  app: INestApplication,
  account: { email: string; password: string },
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send(account);
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(
      `login failed for ${account.email}: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.access_token as string;
}

// Convenience: an authorized supertest request agent helper.
export function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}
