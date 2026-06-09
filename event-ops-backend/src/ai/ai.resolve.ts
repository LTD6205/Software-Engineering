// Resolve model-supplied references (task/event/group) to real ids, and mint a
// fallback password for AI-created users. Pure helpers — they operate on the
// lists/maps passed in (no DB access).
import { randomBytes } from 'crypto';
import { TaskRef } from './ai.types';

// Resolve a model-supplied task_ref to a real task in this event: an exact id
// match first, else a case-insensitive name match. Null when no match.
export function resolveTaskRef(ref: string, tasks: TaskRef[]): TaskRef | null {
  const needle = ref.trim().toLowerCase();
  return (
    tasks.find((t) => t.task_id.toLowerCase() === needle) ??
    tasks.find((t) => t.task_name.trim().toLowerCase() === needle) ??
    null
  );
}

// Resolve a model-supplied event_ref to a real event id the actor can see: an
// exact id match first, else a case-insensitive event-name match. When no ref
// is given, fall back to the request's default event. Null when no match.
export function resolveEventRef(
  ref: string | undefined,
  events: { event_id: string; event_name: string }[],
  defaultEventId?: string,
): string | null {
  if (!ref) return defaultEventId ?? null;
  const needle = ref.trim().toLowerCase();
  return (
    events.find((e) => e.event_id.toLowerCase() === needle)?.event_id ??
    events.find((e) => e.event_name.trim().toLowerCase() === needle)
      ?.event_id ??
    null
  );
}

// Resolve a model-supplied group_ref to a real group id in this event: an exact
// id match first, else a case-insensitive group-title match. Null when no match.
export function resolveGroupRef(
  ref: string,
  groupIds: Set<string>,
  groupByTitle: Map<string, string>,
): string | null {
  const needle = ref.trim().toLowerCase();
  if (groupIds.has(ref)) return ref;
  return groupByTitle.get(needle) ?? null;
}

// A cryptographically-random fallback password for an AI-created user when the
// command supplies none — base64url + a fixed suffix satisfies the complexity
// policy. The account is expected to reset it on first use.
export function tempPassword(): string {
  return `Tmp_${randomBytes(16).toString('base64url')}A1`;
}
