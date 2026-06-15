import { AiActionKind } from './ai.types';

// Which roles may perform each action, mirroring the controllers' @Roles
// (admin is the superuser and appears on every entry). This is a HARD gate in
// AiService — not all services self-enforce role (see spec Safety model).
export const AI_ACTION_ROLES: Record<AiActionKind, string[]> = {
  create: ['manager', 'admin'],
  update: ['manager', 'admin'],
  reassign: ['manager', 'admin'],
  unassign: ['manager', 'admin'],
  delete: ['manager', 'admin'],
  undo: ['manager', 'admin'],
  merge: ['manager', 'admin'],
  add_to_group: ['manager', 'admin'],
  rename_group: ['manager', 'admin'],
  ungroup: ['manager', 'admin'],
  create_event: ['organizer', 'admin'],
  update_event: ['organizer', 'admin'],
  delete_event: ['organizer', 'admin'],
  add_event_manager: ['organizer', 'admin'],
  remove_event_manager: ['organizer', 'admin'],
  create_user: ['admin'],
  update_user: ['admin'],
  reset_password: ['admin'],
  request_reassign: ['manager', 'admin'],
  accept_reassign: ['manager', 'admin'],
  reject_reassign: ['manager', 'admin'],
  cancel_reassign: ['manager', 'admin'],
  remove_from_team: ['manager', 'admin'],
};

export function isActionAllowedForRole(role: string, action: string): boolean {
  const roles = (AI_ACTION_ROLES as Record<string, string[]>)[action];
  return !!roles && roles.includes(role);
}
