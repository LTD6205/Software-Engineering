import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { resolveJwtSecret } from './jwt-secret';

function build(user: unknown) {
  const config = { get: jest.fn().mockReturnValue('test-secret') };
  const userRepo = { findOne: jest.fn().mockResolvedValue(user) };
  return {
    strategy: new JwtStrategy(config as never, userRepo as never),
    userRepo,
  };
}

const TOKEN = { sub: 'u1', email: 'e@x.com', role: 'staff', name: 'Sam' };

describe('JwtStrategy.validate', () => {
  it('re-loads the user and reflects the CURRENT db role, not the token role', async () => {
    // Token says staff, but the user has since been promoted to manager.
    const { strategy } = build({
      user_id: 'u1',
      email: 'e@x.com',
      role: 'manager',
      name: 'Sam',
      is_active: true,
    });
    const result = await strategy.validate({ ...TOKEN, role: 'staff' });
    expect(result.role).toBe('manager');
    expect(result.sub).toBe('u1');
  });

  it('rejects a deactivated account even with a still-valid token', async () => {
    const { strategy } = build({
      user_id: 'u1',
      email: 'e@x.com',
      role: 'staff',
      name: 'Sam',
      is_active: false,
    });
    await expect(strategy.validate(TOKEN)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token whose user no longer exists', async () => {
    const { strategy } = build(null);
    await expect(strategy.validate(TOKEN)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('resolveJwtSecret', () => {
  it('returns the configured secret when present', () => {
    expect(resolveJwtSecret({ get: () => 'configured' } as never)).toBe(
      'configured',
    );
  });

  it('throws in production when JWT_SECRET is missing', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => resolveJwtSecret({ get: () => undefined } as never)).toThrow(
        /JWT_SECRET/,
      );
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('falls back to a dev secret outside production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      expect(resolveJwtSecret({ get: () => undefined } as never)).toBeTruthy();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
