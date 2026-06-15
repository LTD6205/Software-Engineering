import { AiAction } from './ai.types';
import { normalisePriority } from './ai.parse';

// Runtime validation of the model's JSON array of actions. Unknown/missing
// `action` defaults to 'create' (backward compatible with the old
// array-of-tasks format). Malformed items (e.g. a create with no name, or an
// update/reassign with no task_ref) are dropped and counted.
export function validateActions(parsed: unknown[]): {
  actions: AiAction[];
  skipped: number;
} {
  const actions: AiAction[] = [];
  let skipped = 0;
  for (const raw of parsed) {
    const item = (raw ?? {}) as Record<string, unknown>;
    const action =
      typeof item.action === 'string' ? item.action.toLowerCase() : 'create';
    const ref = typeof item.task_ref === 'string' ? item.task_ref.trim() : '';
    const name =
      typeof item.task_name === 'string' ? item.task_name.trim() : '';
    const assignedTo =
      typeof item.assigned_to === 'string' ? item.assigned_to : '';
    const targetRef =
      typeof item.target_ref === 'string' ? item.target_ref.trim() : '';
    const groupRef =
      typeof item.group_ref === 'string' ? item.group_ref.trim() : '';
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const eventRef =
      typeof item.event_ref === 'string' ? item.event_ref.trim() : '';
    const eventName =
      typeof item.event_name === 'string' ? item.event_name.trim() : '';
    const startTime =
      typeof item.start_time === 'string' ? item.start_time.trim() : '';
    const endTime =
      typeof item.end_time === 'string' ? item.end_time.trim() : '';
    const description =
      typeof item.description === 'string' ? item.description.trim() : '';
    const managerRef =
      typeof item.manager_ref === 'string' ? item.manager_ref.trim() : '';
    const userName = typeof item.name === 'string' ? item.name.trim() : '';
    const email = typeof item.email === 'string' ? item.email.trim() : '';
    const phone = typeof item.phone === 'string' ? item.phone.trim() : '';
    const password =
      typeof item.password === 'string' ? item.password : undefined;
    const role = typeof item.role === 'string' ? item.role.trim() : '';
    const userRef =
      typeof item.user_ref === 'string' ? item.user_ref.trim() : '';
    const newPassword =
      typeof item.new_password === 'string' ? item.new_password : '';
    const staffRef =
      typeof item.staff_ref === 'string' ? item.staff_ref.trim() : '';
    const targetManagerRef =
      typeof item.target_manager_ref === 'string'
        ? item.target_manager_ref.trim()
        : '';
    const isActive =
      typeof item.is_active === 'boolean' ? item.is_active : undefined;

    if (action === 'update') {
      if (!ref) {
        skipped++;
        continue;
      }
      const status =
        item.status === 'in_progress' ||
        item.status === 'completed' ||
        item.status === 'overdue'
          ? item.status
          : undefined;
      // An update that changes nothing usable is dropped.
      if (
        !name &&
        item.priority === undefined &&
        !startTime &&
        item.deadline === undefined &&
        !status
      ) {
        skipped++;
        continue;
      }
      actions.push({
        action: 'update',
        task_ref: ref,
        ...(name ? { task_name: name } : {}),
        ...(item.priority !== undefined
          ? { priority: normalisePriority(item.priority) }
          : {}),
        ...(startTime ? { start_time: startTime } : {}),
        ...(typeof item.deadline === 'string'
          ? { deadline: item.deadline }
          : {}),
        ...(status ? { status } : {}),
      });
    } else if (action === 'reassign') {
      if (!ref || !assignedTo.trim()) {
        skipped++;
        continue;
      }
      actions.push({
        action: 'reassign',
        task_ref: ref,
        assigned_to: assignedTo,
      });
    } else if (action === 'unassign') {
      if (!ref) {
        skipped++;
        continue;
      }
      actions.push({ action: 'unassign', task_ref: ref });
    } else if (action === 'delete') {
      if (!ref) {
        skipped++;
        continue;
      }
      actions.push({ action: 'delete', task_ref: ref });
    } else if (action === 'undo') {
      actions.push({ action: 'undo' });
    } else if (action === 'merge') {
      if (!ref || !targetRef) {
        skipped++;
        continue;
      }
      actions.push({ action: 'merge', task_ref: ref, target_ref: targetRef });
    } else if (action === 'add_to_group') {
      if (!groupRef || !ref) {
        skipped++;
        continue;
      }
      actions.push({
        action: 'add_to_group',
        group_ref: groupRef,
        task_ref: ref,
      });
    } else if (action === 'rename_group') {
      if (!groupRef || !title) {
        skipped++;
        continue;
      }
      actions.push({ action: 'rename_group', group_ref: groupRef, title });
    } else if (action === 'ungroup') {
      if (!ref) {
        skipped++;
        continue;
      }
      actions.push({ action: 'ungroup', task_ref: ref });
    } else if (action === 'create_event') {
      if (!eventName || !startTime || !endTime) {
        skipped++;
        continue;
      }
      actions.push({
        action: 'create_event',
        event_name: eventName,
        start_time: startTime,
        end_time: endTime,
        ...(description ? { description } : {}),
      });
    } else if (action === 'update_event') {
      if (!eventRef || (!eventName && !description && !startTime && !endTime)) {
        skipped++;
        continue;
      }
      actions.push({
        action: 'update_event',
        event_ref: eventRef,
        ...(eventName ? { event_name: eventName } : {}),
        ...(description ? { description } : {}),
        ...(startTime ? { start_time: startTime } : {}),
        ...(endTime ? { end_time: endTime } : {}),
      });
    } else if (action === 'delete_event') {
      if (!eventRef) {
        skipped++;
        continue;
      }
      actions.push({ action: 'delete_event', event_ref: eventRef });
    } else if (action === 'add_event_manager') {
      if (!eventRef || !managerRef) {
        skipped++;
        continue;
      }
      actions.push({
        action: 'add_event_manager',
        event_ref: eventRef,
        manager_ref: managerRef,
      });
    } else if (action === 'remove_event_manager') {
      if (!eventRef || !managerRef) {
        skipped++;
        continue;
      }
      actions.push({
        action: 'remove_event_manager',
        event_ref: eventRef,
        manager_ref: managerRef,
      });
    } else if (action === 'create_user') {
      if (!userName || !email) {
        skipped++;
        continue;
      }
      actions.push({
        action: 'create_user',
        name: userName,
        email,
        ...(role ? { role } : {}),
        ...(phone ? { phone } : {}),
        ...(password !== undefined ? { password } : {}),
      });
    } else if (action === 'update_user') {
      // Need a target plus at least one changeable field.
      if (!userRef || (!userName && !role && isActive === undefined)) {
        skipped++;
        continue;
      }
      actions.push({
        action: 'update_user',
        user_ref: userRef,
        ...(userName ? { name: userName } : {}),
        ...(role ? { role } : {}),
        ...(isActive !== undefined ? { is_active: isActive } : {}),
      });
    } else if (action === 'reset_password') {
      if (!userRef || !newPassword) {
        skipped++;
        continue;
      }
      actions.push({
        action: 'reset_password',
        user_ref: userRef,
        new_password: newPassword,
      });
    } else if (action === 'request_reassign') {
      if (!staffRef || !targetManagerRef) {
        skipped++;
        continue;
      }
      actions.push({
        action: 'request_reassign',
        staff_ref: staffRef,
        target_manager_ref: targetManagerRef,
      });
    } else if (
      action === 'accept_reassign' ||
      action === 'reject_reassign' ||
      action === 'cancel_reassign' ||
      action === 'remove_from_team'
    ) {
      if (!staffRef) {
        skipped++;
        continue;
      }
      actions.push({ action, staff_ref: staffRef });
    } else {
      // create (default)
      if (!name) {
        skipped++;
        continue;
      }
      const group =
        typeof item.group === 'string' && item.group.trim()
          ? item.group.trim()
          : undefined;
      actions.push({
        action: 'create',
        task_name: name,
        priority: normalisePriority(item.priority),
        assigned_to: assignedTo,
        ...(startTime ? { start_time: startTime } : {}),
        deadline: typeof item.deadline === 'string' ? item.deadline : '',
        ...(group ? { group } : {}),
      });
    }
  }
  // Cap a single command at 40 actions so a runaway generative reply can't fan
  // out into an unbounded batch of writes; the overflow is counted as skipped.
  const MAX_ACTIONS = 40;
  if (actions.length > MAX_ACTIONS) {
    skipped += actions.length - MAX_ACTIONS;
    actions.length = MAX_ACTIONS;
  }
  return { actions, skipped };
}
