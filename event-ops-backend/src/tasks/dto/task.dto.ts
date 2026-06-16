import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsNumber,
  IsArray,
  IsDateString,
  IsIn,
  MaxLength,
  ValidateIf,
} from 'class-validator';

// PUT /tasks/:id — edit an existing task. Mirrors TasksService.UPDATABLE_FIELDS:
// server-owned fields (event_id, created_by, task_id, group_id, created_at) are
// absent so a task can't be moved between events or re-attributed, and the
// global whitelist strips them if sent. actor_user_id is accepted but dropped by
// the controller (the actor comes from the verified JWT, never the body).
export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  task_name?: string;

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
  @IsIn(['in_progress', 'completed', 'overdue'])
  status?: string;

  @IsOptional()
  @IsDateString()
  start_time?: string;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  // The custom progress label to attach (UUID) or null to clear it.
  @IsOptional()
  @ValidateIf((o: UpdateTaskDto) => o.custom_status_id !== null)
  @IsUUID()
  custom_status_id?: string | null;

  @IsOptional()
  @IsUUID()
  actor_user_id?: string;
}

// POST /tasks/event/:eventId/custom-statuses — define a reusable progress label.
export class CreateCustomStatusDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string | null;
}

// POST /tasks/:id/links — link this task to another task in the same event.
export class LinkTaskDto {
  @IsUUID()
  target_task_id: string;
}

// POST /tasks/groups/merge — merge one task into another (creates/extends a group).
export class MergeTasksDto {
  @IsUUID()
  source_id: string;

  @IsUUID()
  target_id: string;
}

// POST /tasks/groups/:groupId/add — add a task to an existing group.
export class AddToGroupDto {
  @IsUUID()
  task_id: string;
}

// PUT /tasks/groups/:groupId — rename a group.
export class RenameGroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;
}

// PUT /tasks/:id/assignments — replace the whole assignee set in one call.
export class SetAssigneesDto {
  @IsArray()
  @IsUUID('all', { each: true })
  user_ids: string[];
}

// POST /tasks/batch/delete | /tasks/batch/ungroup — act on several tasks at once.
export class BatchTaskIdsDto {
  @IsArray()
  @IsUUID('all', { each: true })
  task_ids: string[];
}
