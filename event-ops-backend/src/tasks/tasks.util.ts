// Pure task helpers extracted from TasksService: scheduling validators and the
// auto-priority math. No repository/DB access — unit-tested via tasks.service
// specs (and trivially testable in isolation).
import { BadRequestException } from '@nestjs/common';
import { Task } from '../entities/task.entity';
import { Event } from '../entities/event.entity';

// Client-sent "now" can read as a few seconds past by the time the server
// checks. Allow a small slack so only clearly-past times (minutes+ old) are
// rejected.
export const PAST_GRACE_MS = 2 * 60 * 1000;

// New or edited task times may not land in the past — the API mirror of the
// timeline's "now" line. Only the values passed in are checked, so editing an
// unrelated field on an already-running (or overdue) task, or reopening it via
// a status change, is unaffected; only a start/deadline being set into the past
// is rejected.
export function assertNotInPast(
  ...values: Array<Date | string | null | undefined>
): void {
  const cutoff = Date.now() - PAST_GRACE_MS;
  for (const v of values) {
    if (!v) continue;
    const t = new Date(v).getTime();
    if (isNaN(t)) continue;
    if (t < cutoff) {
      throw new BadRequestException(
        'Task times cannot be in the past / Thời gian công việc không thể ở quá khứ',
      );
    }
  }
}

// A task's start/deadline must sit inside its event's [start, end] window.
export function assertWithinEventWindow(
  event: Event,
  start?: Date | string | null,
  deadline?: Date | string | null,
): void {
  const es = event.start_time ? new Date(event.start_time).getTime() : null;
  const ee = event.end_time ? new Date(event.end_time).getTime() : null;
  for (const v of [start, deadline]) {
    if (!v) continue;
    const t = new Date(v).getTime();
    if (isNaN(t)) continue;
    if ((es !== null && t < es) || (ee !== null && t > ee)) {
      throw new BadRequestException(
        'Task times must be within the event window / Thời gian công việc phải nằm trong khoảng thời gian của sự kiện',
      );
    }
  }
}

// A task's basis time for auto-priority: its deadline, else its start_time,
// else NaN (undated).
export function taskBasis(t: Task): number {
  const d = t.deadline ? new Date(t.deadline).getTime() : NaN;
  const s = t.start_time ? new Date(t.start_time).getTime() : NaN;
  return !isNaN(d) ? d : s;
}

// The [min, span] of a set of tasks' basis times (undated tasks ignored).
export function windowOf(cohort: Task[]): [number, number] | null {
  const times = cohort.map(taskBasis).filter((v) => !isNaN(v));
  if (times.length === 0) return null;
  const min = Math.min(...times);
  return [min, Math.max(...times) - min];
}

// Auto-priority bucket for a basis time within a [min, span] window. Anything
// past the "now" line is always High regardless of the window; otherwise the
// earliest third is High, the middle Medium, the latest Low.
export function priorityFor(
  basisMs: number,
  min: number,
  span: number,
  now: number,
): { label: string; score: number } {
  let label: string;
  if (basisMs < now) {
    label = 'high';
  } else {
    const frac = span <= 0 ? 0 : (basisMs - min) / span;
    label = frac < 1 / 3 ? 'high' : frac < 2 / 3 ? 'medium' : 'low';
  }
  const score = label === 'high' ? 90 : label === 'medium' ? 50 : 10;
  return { label, score };
}
