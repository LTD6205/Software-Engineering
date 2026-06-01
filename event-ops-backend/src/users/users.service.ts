import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  // Get all users (manager only) — excludes password_hash
  findAll() {
    return this.userRepo.find({
      select: ['user_id', 'name', 'email', 'role', 'is_active', 'created_at'],
      order: { created_at: 'ASC' },
    });
  }

  // Minimal roster any signed-in user may see (for the online/presence board).
  // No emails or other sensitive fields.
  directory() {
    return this.userRepo.find({
      select: ['user_id', 'name', 'role'],
      where: { is_active: true },
      order: { role: 'ASC', name: 'ASC' },
    });
  }

  // Get single user
  async findOne(id: string) {
    const user = await this.userRepo.findOne({
      where: { user_id: id },
      select: ['user_id', 'name', 'email', 'role', 'is_active', 'created_at'],
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // Manager creates a new staff account
  async create(data: {
    name: string;
    email: string;
    password: string;
    role?: string;
  }) {
    if (!data.name || !data.email || !data.password) {
      throw new BadRequestException(
        'Name, email and password are required / Vui lòng nhập tên, email và mật khẩu',
      );
    }
    const exists = await this.userRepo.findOne({
      where: { email: data.email },
    });
    if (exists) {
      throw new ConflictException(
        'Email already in use / Email đã được sử dụng',
      );
    }

    const password_hash = await bcrypt.hash(data.password, 10);
    const user = this.userRepo.create({
      name: data.name,
      email: data.email,
      role: data.role || 'staff',
      password_hash,
    });
    const saved = await this.userRepo.save(user);
    // Re-fetch through findOne so the password_hash is never returned.
    return this.findOne(saved.user_id);
  }

  // Manager updates a user (name, role, active status)
  async update(
    id: string,
    data: {
      name?: string;
      role?: string;
      is_active?: boolean;
      password?: string;
    },
  ) {
    await this.findOne(id);
    const updateData: Partial<User> = {};
    if (data.name) updateData.name = data.name;
    if (data.role) updateData.role = data.role;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;
    if (data.password)
      updateData.password_hash = await bcrypt.hash(data.password, 10);
    await this.userRepo.update(id, updateData);
    return this.findOne(id);
  }

  // Deactivate user (soft delete — never hard delete users)
  async deactivate(id: string) {
    await this.findOne(id);
    await this.userRepo.update(id, { is_active: false });
    return { message: 'User deactivated' };
  }
}
