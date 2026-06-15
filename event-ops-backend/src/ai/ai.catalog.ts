// The action catalog advertised to the model: one JSON shape per action kind,
// filtered to the actor's role. Pure (role allow-list only) — no DB access.
import { AiActionKind } from './ai.types';
import { isActionAllowedForRole, AI_ACTION_ROLES } from './ai.authz';

// One-line JSON shape per action kind. Only the shapes whose role allow-list
// includes the actor are emitted (so the prompt never describes an action the
// role cannot perform).
export const ACTION_SHAPES: Record<AiActionKind, string> = {
  create:
    '{ "action": "create", "task_name": "string", "priority": "low|medium|high", "assigned_to": "name or email", "start_time": "YYYY-MM-DDTHH:mm:ss", "deadline": "YYYY-MM-DDTHH:mm:ss", "group"?: "group title" }',
  update:
    '{ "action": "update", "task_ref": "task name or id", "task_name"?: "string (rename)", "priority"?: "low|medium|high", "start_time"?: "YYYY-MM-DDTHH:mm:ss", "deadline"?: "YYYY-MM-DDTHH:mm:ss", "status"?: "in_progress|completed|overdue" }',
  reassign:
    '{ "action": "reassign", "task_ref": "task name or id", "assigned_to": "name or email" }',
  unassign: '{ "action": "unassign", "task_ref": "task name or id" }',
  delete: '{ "action": "delete", "task_ref": "task name or id" }',
  undo: '{ "action": "undo" }',
  merge:
    '{ "action": "merge", "task_ref": "source task", "target_ref": "target task" }',
  add_to_group:
    '{ "action": "add_to_group", "group_ref": "group title or id", "task_ref": "task name or id" }',
  rename_group:
    '{ "action": "rename_group", "group_ref": "group title or id", "title": "new title" }',
  ungroup: '{ "action": "ungroup", "task_ref": "task name or id" }',
  create_event:
    '{ "action": "create_event", "event_name": "string", "start_time": "YYYY-MM-DDTHH:mm:ss", "end_time": "YYYY-MM-DDTHH:mm:ss", "description"?: "string" }',
  update_event:
    '{ "action": "update_event", "event_ref": "event name or id", "event_name"?: "string", "description"?: "string", "start_time"?: "YYYY-MM-DDTHH:mm:ss", "end_time"?: "YYYY-MM-DDTHH:mm:ss" }',
  delete_event:
    '{ "action": "delete_event", "event_ref": "event name or id" }',
  add_event_manager:
    '{ "action": "add_event_manager", "event_ref": "event name or id", "manager_ref": "manager name or email" }',
  remove_event_manager:
    '{ "action": "remove_event_manager", "event_ref": "event name or id", "manager_ref": "manager name or email" }',
  create_user:
    '{ "action": "create_user", "name": "string", "email": "string", "role"?: "staff|manager|organizer", "phone"?: "string" }',
  update_user:
    '{ "action": "update_user", "user_ref": "name or email", "name"?: "string", "role"?: "string", "is_active"?: true|false }',
  reset_password:
    '{ "action": "reset_password", "user_ref": "name or email", "new_password": "string" }',
  request_reassign:
    '{ "action": "request_reassign", "staff_ref": "name or email", "target_manager_ref": "manager name or email" }',
  accept_reassign: '{ "action": "accept_reassign", "staff_ref": "name or email" }',
  reject_reassign: '{ "action": "reject_reassign", "staff_ref": "name or email" }',
  cancel_reassign: '{ "action": "cancel_reassign", "staff_ref": "name or email" }',
};

// The allowed action shapes for a role, one per line, derived from the same
// role allow-list used by the hard gate.
export function buildActionCatalog(role: string): string {
  const shapes = (Object.keys(AI_ACTION_ROLES) as AiActionKind[]).filter(
    (kind) => isActionAllowedForRole(role, kind),
  );
  if (!shapes.length) {
    return '  (your role has no write actions; you may only answer questions)';
  }
  return shapes.map((kind) => `  ${ACTION_SHAPES[kind]}`).join('\n');
}
