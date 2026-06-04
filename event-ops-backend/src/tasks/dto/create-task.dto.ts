import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsNumber,
  IsDateString,
  IsIn,
  MaxLength,
} from 'class-validator';

// created_by is intentionally absent — the controller sets it from the JWT, and
// whitelist strips any client-supplied value.
export class CreateTaskDto {
  @IsUUID()
  event_id: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  task_name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  priority_label?: string;

  @IsOptional()
  @IsNumber()
  priority_score?: number;

  @IsOptional()
  @IsIn(['user', 'ai', 'auto'])
  priority_source?: string;

  @IsOptional()
  @IsIn(['pending', 'in_progress', 'completed', 'overdue'])
  status?: string;

  @IsOptional()
  @IsDateString()
  start_time?: string;

  @IsOptional()
  @IsDateString()
  deadline?: string;
}
