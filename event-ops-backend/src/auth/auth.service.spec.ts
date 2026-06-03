import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { User } from '../entities/user.entity';

// bcrypt.compare is a non-configurable native binding, so mock the module
// rather than spying on the property.
jest.mock('bcrypt');
const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: { findOne: jest.Mock };
  let jwtService: { sign: jest.Mock };

  const activeUser = {
    user_id: 'u1',
    name: 'Alice',
    email: 'alice@example.com',
    role: 'manager',
    phone: '123',
    avatar: null,
    password_hash: 'hashed',
    is_active: true,
  } as unknown as User;

  beforeEach(() => {
    userRepo = { findOne: jest.fn() };
    jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    service = new AuthService(
      userRepo as never,
      jwtService as unknown as JwtService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  describe('validateUser', () => {
    it('returns the user when email + password are correct', async () => {
      userRepo.findOne.mockResolvedValue(activeUser);
      mockedBcrypt.compare.mockResolvedValue(true as never);

      const result = await service.validateUser('alice@example.com', 'pw');

      expect(result).toBe(activeUser);
      // Only active users may authenticate.
      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { email: 'alice@example.com', is_active: true },
      });
    });

    it('throws Unauthorized when no matching active user exists', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.validateUser('nope@x.com', 'pw')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws Unauthorized when the password does not match', async () => {
      userRepo.findOne.mockResolvedValue(activeUser);
      mockedBcrypt.compare.mockResolvedValue(false as never);
      await expect(
        service.validateUser('alice@example.com', 'wrong'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws Unauthorized when the user has no password hash', async () => {
      userRepo.findOne.mockResolvedValue({
        ...activeUser,
        password_hash: null,
      });
      await expect(
        service.validateUser('alice@example.com', 'pw'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('login', () => {
    it('returns an access token and a sanitized user (no password_hash)', async () => {
      userRepo.findOne.mockResolvedValue(activeUser);
      mockedBcrypt.compare.mockResolvedValue(true as never);

      const result = await service.login('alice@example.com', 'pw');

      expect(result.access_token).toBe('signed.jwt.token');
      expect(result.user).toMatchObject({
        user_id: 'u1',
        email: 'alice@example.com',
        role: 'manager',
      });
      expect(result.user).not.toHaveProperty('password_hash');
      // JWT payload carries sub/email/role/name.
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'u1',
          email: 'alice@example.com',
          role: 'manager',
        }),
      );
    });

    it('propagates the Unauthorized error from validateUser on bad credentials', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.login('x@x.com', 'pw')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(jwtService.sign).not.toHaveBeenCalled();
    });
  });
});
