import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsArray,
  IsUUID,
  IsIn,
  MaxLength,
} from 'class-validator';

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  event_name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  start_time: string;

  @IsDateString()
  end_time: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  manager_ids?: string[];
}

// Event detail edit. Deliberately narrow: only name/description are editable
// here. Dates go through PUT /events/:id/dates (UpdateDatesDto) so task
// shift/delete handling can't be bypassed, and server-owned fields
// (event_id, created_by, status, created_at) are never accepted from the body.
export class UpdateEventDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  event_name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateDatesDto {
  @IsDateString()
  start_time: string;

  @IsDateString()
  end_time: string;

  @IsIn(['delete', 'shift'])
  task_strategy: 'delete' | 'shift';
}
