import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsIn,
  IsUUID,
  MaxLength,
  Matches,
} from 'class-validator';

// The four roles the system recognises (exact-match RBAC, no hierarchy).
const ROLES = ['staff', 'manager', 'organizer', 'admin'];

// Cap a base64 avatar at ~1.5 MB of characters so a huge data URL can't bloat
// the request/DB. (The body limit is 8 MB; this is the per-field guard.)
const AVATAR_MAX = 2_000_000;

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsOptional()
  @Matches(/^\d{10}$/, { message: 'Phone number must be exactly 10 digits' })
  phone?: string;

  @IsOptional()
  @IsIn(ROLES)
  role?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(ROLES)
  role?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  password?: string;
}

// POST /users/:id/reassign — propose moving a staff member to another manager.
export class ReassignDto {
  @IsUUID()
  target_manager_id: string;
}

export class UpdateProfileDto {
  @IsString()
  @IsNotEmpty()
  current_password: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(AVATAR_MAX, { message: 'Avatar image is too large' })
  avatar?: string;

  @IsOptional()
  @IsString()
  new_password?: string;
}
