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
      select: [
        'user_id',
        'name',
        'email',
        'role',
        'phone',
        'avatar',
        'is_active',
        'created_at',
      ],
      order: { created_at: 'ASC' },
    });
  }

  // Roster any signed-in user may see. Staff use this and may only see emails
  // (not phone numbers) of others — so phone is intentionally excluded here.
  directory() {
    return this.userRepo.find({
      select: ['user_id', 'name', 'role', 'email', 'avatar'],
      where: { is_active: true },
      order: { role: 'ASC', name: 'ASC' },
    });
  }

  // Email must contain "@" and be <= 50 chars; phone must be exactly 10 digits.
  private validateContact(email?: string, phone?: string) {
    if (email !== undefined && (!email.includes('@') || email.length > 50)) {
      throw new BadRequestException(
        'Email must contain "@" and be at most 50 characters / Email phải chứa "@" và không quá 50 ký tự',
      );
    }
    if (phone !== undefined && !/^\d{10}$/.test(phone)) {
      throw new BadRequestException(
        'Phone number must be exactly 10 digits / Số điện thoại phải gồm đúng 10 chữ số',
      );
    }
  }

  // A user updates their OWN profile. Requires the current password.
  async updateProfile(
    userId: string,
    data: {
      current_password: string;
      name?: string;
      email?: string;
      phone?: string;
      avatar?: string;
      new_password?: string;
    },
  ) {
    const user = await this.userRepo.findOne({ where: { user_id: userId } });
    if (!user)
      throw new NotFoundException('User not found / Không tìm thấy người dùng');

    const ok =
      user.password_hash &&
      (await bcrypt.compare(data.current_password || '', user.password_hash));
    if (!ok) {
      throw new BadRequestException(
        'Current password is incorrect / Mật khẩu hiện tại không đúng',
      );
    }

    this.validateContact(data.email, data.phone);

    if (data.email && data.email !== user.email) {
      const exists = await this.userRepo.findOne({
        where: { email: data.email },
      });
      if (exists) {
        throw new ConflictException(
          'Email already in use / Email đã được sử dụng',
        );
      }
    }

    const update: Partial<User> = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.email !== undefined) update.email = data.email;
    if (data.phone !== undefined) update.phone = data.phone;
    if (data.avatar !== undefined) update.avatar = data.avatar;
    if (data.new_password)
      update.password_hash = await bcrypt.hash(data.new_password, 10);

    await this.userRepo.update(userId, update);
    return this.findOne(userId);
  }

  // Get single user
  async findOne(id: string) {
    const user = await this.userRepo.findOne({
      where: { user_id: id },
      select: [
        'user_id',
        'name',
        'email',
        'role',
        'phone',
        'avatar',
        'is_active',
        'created_at',
      ],
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // Manager creates a new staff account
  async create(data: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    role?: string;
  }) {
    if (!data.name || !data.email || !data.password || !data.phone) {
      throw new BadRequestException(
        'Name, email, phone and password are required / Vui lòng nhập tên, email, số điện thoại và mật khẩu',
      );
    }
    this.validateContact(data.email, data.phone);
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
      phone: data.phone,
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
