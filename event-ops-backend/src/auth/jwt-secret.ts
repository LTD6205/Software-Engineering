import { ConfigService } from '@nestjs/config';

// Single source of truth for the JWT signing secret. In production a missing
// JWT_SECRET is a hard failure (so a public deploy never silently signs tokens
// with a well-known default); in development we fall back to a fixed dev secret
// for convenience.
export function resolveJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET must be set in production. Refusing to start with the default development secret.',
    );
  }
  return 'eventops_secret_key';
}
