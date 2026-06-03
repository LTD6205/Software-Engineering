import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { resolveJwtSecret } from './jwt-secret';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  name: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(config),
    });
  }

  // Re-load the user from the database on every request rather than trusting the
  // token payload. This way a deactivated account loses access immediately and a
  // role change takes effect on the next request — not only when the token
  // expires. The returned object becomes `req.user`.
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.userRepo.findOne({
      where: { user_id: payload.sub },
      select: ['user_id', 'email', 'role', 'name', 'is_active'],
    });
    if (!user || !user.is_active) {
      throw new UnauthorizedException(
        'Account is no longer active / Tài khoản không còn hoạt động',
      );
    }
    return {
      sub: user.user_id,
      email: user.email,
      role: user.role,
      name: user.name,
    };
  }
}
