import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

// Both fields required and non-empty, so a missing field can't slip through to
// the bcrypt comparison.
export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  password: string;
}
