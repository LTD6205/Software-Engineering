export type Role = 'admin' | 'organizer' | 'manager' | 'staff';
export type Priority = 'low' | 'medium' | 'high';

export type AiActionKind =
  | 'create'
  | 'update'
  | 'reassign'
  | 'unassign'
  | 'delete'
  | 'merge'
  | 'add_to_group'
  | 'rename_group'
  | 'ungroup'
  | 'create_event'
  | 'update_event'
  | 'delete_event'
  | 'add_event_manager'
  | 'remove_event_manager'
  | 'create_user'
  | 'update_user'
  | 'reset_password'
  | 'request_reassign'
  | 'accept_reassign'
  | 'reject_reassign'
  | 'cancel_reassign';

export interface Actor {
  sub: string;
  role: string;
}

export interface CommandOptions {
  eventId?: string;
  message: string;
  mode?: 'auto' | 'ask';
  history?: { role: 'user' | 'assistant'; content: string }[];
}

// Result buckets returned by executeActions().
export interface ExecResult {
  tasks_created: object[];
  tasks_updated: object[];
  tasks_reassigned: object[];
  tasks_deleted: { task_id: string; task_name: string }[];
  unassigned: { task_id: string; task_name: string }[];
  groups_changed: { action: string; group_id?: string; title?: string }[];
  events_changed: { action: string; event_id?: string; event_name?: string }[];
  users_changed: { action: string; user_id?: string; summary: string }[];
  unresolved: string[];
  rejected: { ref: string; reason: string }[];
  skipped: number;
}
