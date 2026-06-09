// Pure timeline geometry helpers extracted from TaskTimeline. No React state —
// the component passes in the current zoom (pxPerDay) and window (evStart/evEnd).

export const HOUR = 3600000
export const DAY = 86400000

// Candidate axis steps (ms), smallest first.
const TICK_STEPS = [
  15 * 60000,
  30 * 60000,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  7 * DAY,
  14 * DAY,
  30 * DAY,
  90 * DAY,
]

// Parse an ISO string to epoch ms (NaN when absent/invalid).
export const ms = (v?: string | null) => (v ? new Date(v).getTime() : NaN)

// Greedy lane packing: items keep their own [start,end]; non-overlapping ones
// share a lane, overlapping ones drop to the next — so blocks never overlap.
export function packLanes<T extends { start: number; end: number }>(items: T[]) {
  const sorted = [...items].sort((a, b) => a.start - b.start)
  const laneEnd: number[] = []
  const placed = new Map<T, number>()
  for (const it of sorted) {
    let lane = laneEnd.findIndex((end) => end <= it.start)
    if (lane === -1) {
      lane = laneEnd.length
      laneEnd.push(it.end)
    } else laneEnd[lane] = it.end
    placed.set(it, lane)
  }
  return { placed, lanes: Math.max(1, laneEnd.length) }
}

// Date-axis ticks for the current zoom. The major step (labelled) is the finest
// one that still leaves ≥66px between labels; minor gridlines subdivide it ×4
// (so at hour zoom you get unlabelled 15-min marks to place tasks precisely).
export function computeTicks({
  pxPerDay,
  evStart,
  evEnd,
}: {
  pxPerDay: number
  evStart: number
  evEnd: number
}): { majorStep: number; minorStep: number; showMinor: boolean; majors: number[]; minors: number[] } {
  const majorStep =
    pxPerDay > 0
      ? (TICK_STEPS.find((s) => (s / DAY) * pxPerDay >= 66) ??
        TICK_STEPS[TICK_STEPS.length - 1])
      : DAY
  const minorStep = majorStep / 4
  const showMinor =
    pxPerDay > 0 && minorStep >= 5 * 60000 && (minorStep / DAY) * pxPerDay >= 11
  // First tick at/after evStart, aligned to a local boundary of the step.
  const alignedFirst = (step: number) => {
    const d = new Date(evStart)
    if (step >= DAY) {
      d.setHours(0, 0, 0, 0)
    } else {
      const stepMin = step / 60000
      const mod = (d.getHours() * 60 + d.getMinutes()) % stepMin
      d.setSeconds(0, 0)
      d.setMinutes(d.getMinutes() - mod)
    }
    let tk = d.getTime()
    while (tk < evStart) tk += step
    return tk
  }
  const majors: number[] = []
  const minors: number[] = []
  if (pxPerDay > 0) {
    for (let tk = alignedFirst(majorStep); tk <= evEnd && majors.length < 600; tk += majorStep)
      majors.push(tk)
    if (showMinor)
      for (let tk = alignedFirst(minorStep); tk <= evEnd && minors.length < 2500; tk += minorStep)
        minors.push(tk)
  }
  return { majorStep, minorStep, showMinor, majors, minors }
}
