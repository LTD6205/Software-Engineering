import {
  IsOptional,
  IsString,
  IsUUID,
  IsIn,
  IsArray,
  ValidateNested,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AiHistoryTurnDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(4000)
  content: string;
}

export class AiCommandDto {
  // Optional: when present, the default event for task actions + the loaded
  // task context. Absent for cross-event commands ("create an event"…).
  @IsOptional()
  @IsUUID()
  eventId?: string;

  @IsString()
  @MaxLength(4000)
  message: string;

  @IsOptional()
  @IsIn(['auto', 'ask'])
  mode?: 'auto' | 'ask';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AiHistoryTurnDto)
  history?: AiHistoryTurnDto[];
}
