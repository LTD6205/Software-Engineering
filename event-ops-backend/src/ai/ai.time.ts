// Time helpers for the AI pipeline. This demo runs in Vietnam time (ICT, UTC+7):
// the model is shown "now"/windows in +07:00 and emits bare wall-clock times,
// which parseDeadline converts back to a real UTC instant. Pure functions —
// exercised by ai.service.spec.ts.

export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
export const MIN_MS = 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

// Format an instant as Vietnam local time for the prompt, e.g.
// "2026-06-10T20:00:00+07:00". Display only — never stored.
export function fmtVN(value: Date | string | null | undefined): string {
  if (!value) return 'unspecified';
  const t = new Date(value).getTime();
  if (isNaN(t)) return 'unspecified';
  return new Date(t + VN_OFFSET_MS)
    .toISOString()
    .replace(/\.\d{3}Z$/, '+07:00');
}

// Parse a model time string into a UTC Date. A bare wall-clock the model emits
// (e.g. "2026-06-10T20:00:00", no timezone) is interpreted as Vietnam local
// (UTC+7) — matching what the user means and what the browser stores from the
// manual UI, so "8h tối" persists as 13:00Z and renders back as 20:00. An
// explicit Z/offset is honoured as-is. Anything unparseable returns undefined so
// an "Invalid Date" is never persisted.
export function parseDeadline(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  let s = value.trim();
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasTz) {
    if (!s.includes('T')) s += 'T00:00:00'; // date-only → midnight VN
    s += '+07:00';
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

// Fit an AI task's [start, deadline] into [max(now, eventStart) .. eventEnd],
// preserving its intended length where the window allows. Guarantees the result
// never starts in the past and never overflows the event window — so a plan for
// a SHORT event (e.g. one day) is created instead of being rejected by
// TasksService (assertNotInPast / assertWithinEventWindow, REQ-19). When the
// model gives no deadline the value is returned unchanged. With no window it
// degrades to the past-only slide-forward behaviour.
export function fitWindow(
  startTime: Date | undefined,
  deadline: Date | undefined,
  now: number,
  win?: { start: number; end: number },
): { startTime?: Date; deadline?: Date } {
  if (!deadline) return { startTime, deadline };
  const MIN = MIN_MS;
  const HOUR = HOUR_MS;
  // The task's intended length: the model's [start, deadline] span when both
  // are given and valid, otherwise a one-hour default.
  const span =
    startTime && startTime.getTime() < deadline.getTime()
      ? deadline.getTime() - startTime.getTime()
      : HOUR;
  const winStart = win ? Math.max(now, win.start) : now;
  const winEnd = win ? win.end : Number.POSITIVE_INFINITY;
  // The longest length that still fits inside the window; keep at least a
  // minute so start stays strictly before the deadline.
  let effSpan = span;
  if (Number.isFinite(winEnd)) {
    const room = winEnd - winStart;
    effSpan = room > MIN ? Math.min(span, room) : MIN;
  }
  // Anchor on the model's deadline, then pull the window inside [winStart, winEnd].
  let dl = Math.min(deadline.getTime(), winEnd);
  if (dl < winStart + effSpan) dl = winStart + effSpan;
  let st = dl - effSpan;
  if (st < winStart) st = winStart;
  if (dl - st < MIN) dl = st + MIN;
  return { startTime: new Date(st), deadline: new Date(dl) };
}
