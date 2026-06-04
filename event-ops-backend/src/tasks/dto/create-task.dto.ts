import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsDateString,
  IsIn,
  MaxLength,
} from 'class-validator';

// created_by is intentionally absent — the controller sets it from the JWT, and
// whitelist strips any client-supplied value. status, priority_source and
// priority_score are likewise omitted: they're server-derived (a new task starts
// in_progress with an auto-bucketed priority), so an HTTP caller can't set them.
// The AI path provides priority_source/score by calling TasksService.create
// directly, bypassing this DTO.
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
  @IsDateString()
  start_time?: string;

  @IsOptional()
  @IsDateString()
  deadline?: string;
}
