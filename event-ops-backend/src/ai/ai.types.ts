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

// Task action shapes the model may emit beyond create/update/reassign. Each
// routes to an existing TasksService method; the AiAction union (in
// ai.service.ts) includes these.
export interface UnassignAction {
  action: 'unassign';
  task_ref: string;
}
export interface DeleteAction {
  action: 'delete';
  task_ref: string;
}
export interface MergeAction {
  action: 'merge';
  task_ref: string;
  target_ref: string;
}
export interface AddToGroupAction {
  action: 'add_to_group';
  group_ref: string;
  task_ref: string;
}
export interface RenameGroupAction {
  action: 'rename_group';
  group_ref: string;
  title: string;
}
export interface UngroupAction {
  action: 'ungroup';
  task_ref: string;
}

// Event action shapes (organizer/admin only). Each routes to an EventsService
// method; the AiService gates the role and calls assertCanManageEvent itself.
export interface CreateEventAction {
  action: 'create_event';
  event_name: string;
  start_time: string;
  end_time: string;
  description?: string;
}
export interface UpdateEventAction {
  action: 'update_event';
  event_ref: string;
  event_name?: string;
  description?: string;
}
export interface DeleteEventAction {
  action: 'delete_event';
  event_ref: string;
}
export interface AddEventManagerAction {
  action: 'add_event_manager';
  event_ref: string;
  manager_ref: string;
}
export interface RemoveEventManagerAction {
  action: 'remove_event_manager';
  event_ref: string;
  manager_ref: string;
}

// Account / team action shapes (manager/admin; reset_password admin-only). Each
// routes to a UsersService method. AiService replicates the controller-level
// role gates the service itself doesn't enforce (a manager creating only staff,
// admin-only is_active) before calling.
export interface CreateUserAction {
  action: 'create_user';
  name: string;
  email: string;
  role?: string;
  phone?: string;
  password?: string;
}
export interface UpdateUserAction {
  action: 'update_user';
  user_ref: string;
  name?: string;
  role?: string;
  is_active?: boolean;
}
export interface ResetPasswordAction {
  action: 'reset_password';
  user_ref: string;
  new_password: string;
}

// Staff reassignment workflow shapes (manager/admin). Each routes to the
// matching UsersService reassignment method.
export interface RequestReassignAction {
  action: 'request_reassign';
  staff_ref: string;
  target_manager_ref: string;
}
export interface AcceptReassignAction {
  action: 'accept_reassign';
  staff_ref: string;
}
export interface RejectReassignAction {
  action: 'reject_reassign';
  staff_ref: string;
}
export interface CancelReassignAction {
  action: 'cancel_reassign';
  staff_ref: string;
}

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
