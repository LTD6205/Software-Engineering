import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private jwtService: JwtService,
  ) {}

  // Validate user credentials — called during login
  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { email, is_active: true } });
    if (!user || !user.password_hash) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return user;
  }

  // Login — return JWT token + user info
  async login(email: string, password: string) {
    const user = await this.validateUser(email, password);
    const payload = {
      sub:   user.user_id,
      email: user.email,
      role:  user.role,
      name:  user.name,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        user_id: user.user_id,
        name:    user.name,
        email:   user.email,
        role:    user.role,
      },
    };
  }

  // Get current user from token
  async getMe(userId: string) {
    return this.userRepo.findOne({
      where: { user_id: userId },
      select: ['user_id', 'name', 'email', 'role', 'created_at'],
    });
  }
}