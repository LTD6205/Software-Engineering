import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Validate + sanitize request bodies that are typed as DTO classes. `whitelist`
  // strips properties the DTO doesn't declare (so a spoofed created_by/userId is
  // dropped); `transform` coerces payloads to the DTO type. Endpoints still typed
  // with plain interfaces are unaffected (no validation metadata → passed through).
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  // Allow larger request bodies than Express's 100kb default so profile
  // avatar uploads (base64 image data) aren't rejected with 413.
  app.use(json({ limit: '8mb' }));
  app.use(urlencoded({ extended: true, limit: '8mb' }));

  // Allowed browser origins come from env (comma-separated) so local, tunnel,
  // and production set-ups don't need code changes. Defaults to the dev frontend.
  const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3001')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins });
  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Backend running on http://localhost:${port}/api`);
}
void bootstrap();
