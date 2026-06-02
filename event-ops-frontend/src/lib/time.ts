// Task times step in 15-minute increments (like Google Calendar): minutes are
// only ever :00, :15, :30 or :45. `step` constrains the native picker; the snap
// helpers also round any typed/computed value so off-step values can't slip in.

export const QUARTER_HOUR = 15 * 60 * 1000 // ms
export const STEP_SECONDS = 900            // for <input step={...}>

// Snap "HH:MM" to the nearest 15 minutes.
export function snapClock(hhmm: string): string {
  if (!hhmm || !hhmm.includes(':')) return hhmm
  const [h, m] = hhmm.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return hhmm
  let hh = h
  let mm = Math.round(m / 15) * 15
  if (mm === 60) { mm = 0; hh = (h + 1) % 24 }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

// Snap a "YYYY-MM-DDTHH:MM" datetime-local string's minutes.
export function snapDateTimeLocal(v: string): string {
  if (!v || !v.includes('T')) return v
  const [d, time] = v.split('T')
  return `${d}T${snapClock(time)}`
}

// Snap an epoch-ms time to the nearest quarter hour.
export function snapMs(t: number): number {
  return Math.round(t / QUARTER_HOUR) * QUARTER_HOUR
}
