import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private readonly notifications: NotificationsService,
  ) {}

  // Full roster for managers/admins (excludes password_hash). Only admins also
  // get the account active/inactive status.
  findAll(viewerRole?: string) {
    const select: (keyof User)[] = [
      'user_id',
      'name',
      'email',
      'role',
      'phone',
      'avatar',
      'manager_id',
      'pending_manager_id',
      'created_at',
    ];
    if (viewerRole === 'admin') select.push('is_active');
    return this.userRepo.find({ select, order: { created_at: 'ASC' } });
  }

  // Roster any signed-in user may see. Staff use this and may only see emails
  // (not phone numbers) of others — so phone is intentionally excluded here.
  directory() {
    return this.userRepo.find({
      // manager_id is included so a staff member can see their own team
      // (everyone who reports to the same manager).
      select: ['user_id', 'name', 'role', 'email', 'avatar', 'manager_id'],
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
        'manager_id',
        'pending_manager_id',
        'is_active',
        'created_at',
      ],
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // --- Staff → manager reassignment workflow ---
  // The current owner manager (or an admin) proposes moving a staff member to
  // another manager. This only sets pending_manager_id; the target manager must
  // accept before they actually own the staff.
  async requestReassign(
    staffId: string,
    targetManagerId: string,
    actor: { sub: string; role: string },
  ) {
    const staff = await this.userRepo.findOne({
      where: { user_id: staffId },
    });
    if (!staff)
      throw new NotFoundException('User not found / Không tìm thấy người dùng');
    if (staff.role !== 'staff') {
      throw new BadRequestException(
        'Only staff members can be reassigned / Chỉ có thể chuyển nhân viên',
      );
    }
    // Only the current owner manager or an admin may initiate a reassignment.
    if (actor.role !== 'admin' && staff.manager_id !== actor.sub) {
      throw new ForbiddenException(
        'Only the current manager can reassign this staff member / Chỉ quản lý hiện tại mới có thể chuyển nhân viên này',
      );
    }
    if (!targetManagerId) {
      throw new BadRequestException(
        'A target manager is required / Vui lòng chọn quản lý nhận',
      );
    }
    const target = await this.userRepo.findOne({
      where: { user_id: targetManagerId },
    });
    if (!target || target.role !== 'manager') {
      throw new BadRequestException(
        'The target must be a manager / Người nhận phải là quản lý',
      );
    }
    if (target.user_id === staff.manager_id) {
      throw new BadRequestException(
        'This staff member already reports to that manager / Nhân viên này đã thuộc quản lý đó',
      );
    }
    await this.userRepo.update(staffId, {
      pending_manager_id: targetManagerId,
    });
    // Notify the three parties. The staff stays with their current manager
    // (and that manager's projects) until the target manager approves.
    const oldManager = staff.manager_id
      ? await this.userRepo.findOne({ where: { user_id: staff.manager_id } })
      : null;
    const oldName = oldManager?.name ?? '—';
    await this.notifications.notifyUser(
      staff.manager_id ?? '',
      'reassignment',
      `You requested to move ${staff.name} to ${target.name}'s team — awaiting their approval. / Bạn đã yêu cầu chuyển ${staff.name} sang đội của ${target.name} — đang chờ phê duyệt.`,
    );
    await this.notifications.notifyUser(
      target.user_id,
      'reassignment',
      `${oldName} wants to move ${staff.name} into your team. Review the request. / ${oldName} muốn chuyển ${staff.name} sang đội của bạn. Vui lòng xem xét yêu cầu.`,
    );
    await this.notifications.notifyUser(
      staff.user_id,
      'reassignment',
      `You are being moved to ${target.name}'s team, pending their approval. / Bạn đang được chuyển sang đội của ${target.name}, chờ phê duyệt.`,
    );
    return this.findOne(staffId);
  }

  // Pending requests addressed to a manager (they are the proposed new owner).
  incomingReassignRequests(managerId: string): Promise<unknown[]> {
    return this.userRepo.manager.query(
      `SELECT s.user_id, s.name, s.email, s.avatar,
         o.user_id AS current_manager_id, o.name AS current_manager_name
       FROM users s
       LEFT JOIN users o ON o.user_id = s.manager_id
       WHERE s.pending_manager_id = $1
       ORDER BY s.name ASC`,
      [managerId],
    );
  }

  // The target manager accepts: they become the staff member's owner.
  async acceptReassign(staffId: string, actor: { sub: string; role: string }) {
    const staff = await this.userRepo.findOne({ where: { user_id: staffId } });
    if (!staff)
      throw new NotFoundException('User not found / Không tìm thấy người dùng');
    if (actor.role !== 'admin' && staff.pending_manager_id !== actor.sub) {
      throw new ForbiddenException(
        'There is no reassignment request addressed to you / Không có yêu cầu chuyển nào dành cho bạn',
      );
    }
    const newId = staff.pending_manager_id;
    const oldId = staff.manager_id;
    await this.userRepo.update(staffId, {
      manager_id: newId,
      pending_manager_id: null,
    });
    // The staff member leaves the old manager's projects: drop their existing
    // task assignments so a reassigned staffer can't retain access to the old
    // team's event tasks. They start fresh under the new manager.
    await this.userRepo.manager.query(
      'DELETE FROM task_assignments WHERE user_id = $1',
      [staffId],
    );
    // Confirmation: the staff now leaves the old manager's projects and joins
    // the new manager's. Notify the same three parties.
    const newManager = newId
      ? await this.userRepo.findOne({ where: { user_id: newId } })
      : null;
    const newName = newManager?.name ?? '—';
    await this.notifications.notifyUser(
      oldId ?? '',
      'reassignment',
      `${staff.name} has moved to ${newName}'s team. / ${staff.name} đã chuyển sang đội của ${newName}.`,
    );
    await this.notifications.notifyUser(
      newId ?? '',
      'reassignment',
      `You received ${staff.name} into your team. / Bạn đã nhận ${staff.name} vào đội của mình.`,
    );
    await this.notifications.notifyUser(
      staff.user_id,
      'reassignment',
      `You are now in ${newName}'s team. / Bạn hiện thuộc đội của ${newName}.`,
    );
    return this.findOne(staffId);
  }

  // The target manager rejects: the pending request is cleared, owner unchanged.
  async rejectReassign(staffId: string, actor: { sub: string; role: string }) {
    const staff = await this.userRepo.findOne({ where: { user_id: staffId } });
    if (!staff)
      throw new NotFoundException('User not found / Không tìm thấy người dùng');
    if (actor.role !== 'admin' && staff.pending_manager_id !== actor.sub) {
      throw new ForbiddenException(
        'There is no reassignment request addressed to you / Không có yêu cầu chuyển nào dành cho bạn',
      );
    }
    const targetId = staff.pending_manager_id;
    const target = targetId
      ? await this.userRepo.findOne({ where: { user_id: targetId } })
      : null;
    const targetName = target?.name ?? '—';
    await this.userRepo.update(staffId, { pending_manager_id: null });
    // The move was declined; the staff stays with their current manager.
    await this.notifications.notifyUser(
      staff.manager_id ?? '',
      'reassignment',
      `${targetName} declined to take ${staff.name}; they stay in your team. / ${targetName} đã từ chối nhận ${staff.name}; nhân viên vẫn ở đội của bạn.`,
    );
    await this.notifications.notifyUser(
      targetId ?? '',
      'reassignment',
      `You declined to take ${staff.name}. / Bạn đã từ chối nhận ${staff.name}.`,
    );
    await this.notifications.notifyUser(
      staff.user_id,
      'reassignment',
      `Your move to ${targetName} was declined; you stay in your current team. / Yêu cầu chuyển bạn sang ${targetName} đã bị từ chối; bạn vẫn ở đội hiện tại.`,
    );
    return this.findOne(staffId);
  }

  // The requesting owner manager withdraws a pending request before the target
  // acts. Only the current owner (or an admin) can cancel; the staff stays put.
  async cancelReassign(staffId: string, actor: { sub: string; role: string }) {
    const staff = await this.userRepo.findOne({ where: { user_id: staffId } });
    if (!staff)
      throw new NotFoundException('User not found / Không tìm thấy người dùng');
    if (!staff.pending_manager_id) {
      throw new BadRequestException(
        'There is no pending reassignment to cancel / Không có yêu cầu chuyển nào để hủy',
      );
    }
    // Only the manager who owns the staff (the requester) or an admin may cancel.
    if (actor.role !== 'admin' && staff.manager_id !== actor.sub) {
      throw new ForbiddenException(
        'Only the requesting manager can cancel this reassignment / Chỉ quản lý đã gửi yêu cầu mới có thể hủy',
      );
    }
    const targetId = staff.pending_manager_id;
    const target = targetId
      ? await this.userRepo.findOne({ where: { user_id: targetId } })
      : null;
    const targetName = target?.name ?? '—';
    await this.userRepo.update(staffId, { pending_manager_id: null });
    // Withdrawn: the staff stays with the current manager. Notify the parties.
    await this.notifications.notifyUser(
      staff.manager_id ?? '',
      'reassignment',
      `You withdrew the request to move ${staff.name} to ${targetName}'s team. / Bạn đã rút lại yêu cầu chuyển ${staff.name} sang đội của ${targetName}.`,
    );
    await this.notifications.notifyUser(
      targetId ?? '',
      'reassignment',
      `The request to move ${staff.name} into your team was withdrawn. / Yêu cầu chuyển ${staff.name} vào đội của bạn đã được rút lại.`,
    );
    await this.notifications.notifyUser(
      staff.user_id,
      'reassignment',
      `Your pending move to ${targetName} was cancelled; you stay in your current team. / Yêu cầu chuyển bạn sang ${targetName} đã được hủy; bạn vẫn ở đội hiện tại.`,
    );
    return this.findOne(staffId);
  }

  // Manager creates a new staff account
  async create(
    data: {
      name: string;
      email: string;
      password: string;
      phone?: string;
      role?: string;
    },
    actor?: { sub: string; role: string },
  ) {
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

    const role = data.role || 'staff';
    const password_hash = await bcrypt.hash(data.password, 10);
    const user = this.userRepo.create({
      name: data.name,
      email: data.email,
      phone: data.phone,
      role,
      password_hash,
      // A manager's new staff belongs to that manager (so later team/own-staff
      // checks work without a separate assignment step).
      manager_id:
        actor && actor.role === 'manager' && role === 'staff'
          ? actor.sub
          : undefined,
    });
    const saved = await this.userRepo.save(user);
    // Re-fetch through findOne so the password_hash is never returned.
    return this.findOne(saved.user_id);
  }

  // Update a user (name, role, active status). A non-admin actor (a manager)
  // may only edit their own staff, and may not change roles or reset passwords —
  // those are admin-only. With no actor (internal callers/tests) no extra
  // restriction is applied.
  async update(
    id: string,
    data: {
      name?: string;
      role?: string;
      is_active?: boolean;
      password?: string;
    },
    actor?: { sub: string; role: string },
  ) {
    const target = await this.findOne(id);
    if (actor && actor.role !== 'admin') {
      if (target.role !== 'staff' || target.manager_id !== actor.sub) {
        throw new ForbiddenException(
          'You can only manage your own staff / Bạn chỉ có thể quản lý nhân viên của mình',
        );
      }
      if (data.role !== undefined && data.role !== target.role) {
        throw new ForbiddenException(
          "Only an admin can change a user's role / Chỉ quản trị viên mới có thể đổi vai trò",
        );
      }
      if (data.password !== undefined) {
        throw new ForbiddenException(
          "Only an admin can reset another user's password / Chỉ quản trị viên mới có thể đặt lại mật khẩu",
        );
      }
    }
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
