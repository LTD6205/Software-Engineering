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

export class UpdateDatesDto {
  @IsDateString()
  start_time: string;

  @IsDateString()
  end_time: string;

  @IsIn(['delete', 'shift'])
  task_strategy: 'delete' | 'shift';
}
