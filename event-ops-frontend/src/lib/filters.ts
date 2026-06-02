// Helpers for the "nearby / month / date" time filters on the Events and Tasks
// pages. "Nearby" means within ±NEARBY_DAYS of today — the default view, so the
// board focuses on what's happening around now instead of every record ever.

export const NEARBY_DAYS = 30

// [today − NEARBY_DAYS, today + NEARBY_DAYS].
function nearbyWindow(now: Date) {
  const from = new Date(now)
  from.setDate(from.getDate() - NEARBY_DAYS)
  from.setHours(0, 0, 0, 0)
  const to = new Date(now)
  to.setDate(to.getDate() + NEARBY_DAYS)
  to.setHours(23, 59, 59, 999)
  return { from, to }
}

// An event (a [start, end] range) overlaps the ±NEARBY_DAYS window around today.
export function isEventNearby(startISO: string, endISO: string, now: Date = new Date()): boolean {
  const { from, to } = nearbyWindow(now)
  const start = new Date(startISO)
  const end = new Date(endISO)
  return start <= to && end >= from
}

// An event overlaps a given calendar month ("YYYY-MM").
export function isEventInMonth(startISO: string, endISO: string, month: string): boolean {
  if (!month) return true
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return true
  const mStart = new Date(y, m - 1, 1, 0, 0, 0, 0)
  const mEnd = new Date(y, m, 0, 23, 59, 59, 999) // day 0 of next month = last day of this one
  const start = new Date(startISO)
  const end = new Date(endISO)
  return start <= mEnd && end >= mStart
}

// An event covers a given calendar day ("YYYY-MM-DD").
export function isEventOnDate(startISO: string, endISO: string, date: string): boolean {
  if (!date) return true
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return true
  const dStart = new Date(y, m - 1, d, 0, 0, 0, 0)
  const dEnd = new Date(y, m - 1, d, 23, 59, 59, 999)
  const start = new Date(startISO)
  const end = new Date(endISO)
  return start <= dEnd && end >= dStart
}

// A task's deadline is within the ±NEARBY_DAYS window. Tasks with no deadline
// always pass so they're never hidden by the default "nearby" view.
export function isDeadlineNearby(deadlineISO: string | null | undefined, now: Date = new Date()): boolean {
  if (!deadlineISO) return true
  const d = new Date(deadlineISO)
  if (isNaN(d.getTime())) return true
  const { from, to } = nearbyWindow(now)
  return d >= from && d <= to
}
