import {
  NEARBY_DAYS,
  isDeadlineNearby,
  isEventInMonth,
  isEventNearby,
  isEventOnDate,
} from './filters'

// A fixed "now" so the ±30-day window is deterministic.
const NOW = new Date('2026-06-15T12:00:00Z')

describe('filters — time scopes', () => {
  describe('isEventNearby (±NEARBY_DAYS window)', () => {
    it('includes an event overlapping the window', () => {
      expect(
        isEventNearby('2026-06-20T00:00:00Z', '2026-06-21T00:00:00Z', NOW),
      ).toBe(true)
    })

    it('excludes an event entirely after the window', () => {
      const far = new Date(NOW)
      far.setDate(far.getDate() + NEARBY_DAYS + 5)
      const farEnd = new Date(far)
      farEnd.setDate(farEnd.getDate() + 1)
      expect(
        isEventNearby(far.toISOString(), farEnd.toISOString(), NOW),
      ).toBe(false)
    })

    it('excludes an event entirely before the window', () => {
      expect(
        isEventNearby('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', NOW),
      ).toBe(false)
    })

    it('includes an event that straddles the whole window', () => {
      expect(
        isEventNearby('2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z', NOW),
      ).toBe(true)
    })
  })

  describe('isEventInMonth', () => {
    it('matches an event within the month', () => {
      expect(
        isEventInMonth('2026-06-10T00:00:00Z', '2026-06-12T00:00:00Z', '2026-06'),
      ).toBe(true)
    })

    it('rejects an event in a different month', () => {
      expect(
        isEventInMonth('2026-06-10T00:00:00Z', '2026-06-12T00:00:00Z', '2026-08'),
      ).toBe(false)
    })

    it('returns true (no filter) for an empty/invalid month string', () => {
      expect(isEventInMonth('2026-06-10', '2026-06-12', '')).toBe(true)
      expect(isEventInMonth('2026-06-10', '2026-06-12', 'garbage')).toBe(true)
    })
  })

  describe('isEventOnDate', () => {
    it('matches an event covering the date', () => {
      expect(
        isEventOnDate('2026-06-14T00:00:00Z', '2026-06-16T00:00:00Z', '2026-06-15'),
      ).toBe(true)
    })

    it('rejects an event not covering the date', () => {
      expect(
        isEventOnDate('2026-06-01T00:00:00Z', '2026-06-02T00:00:00Z', '2026-06-15'),
      ).toBe(false)
    })

    it('returns true (no filter) for an empty date', () => {
      expect(isEventOnDate('2026-06-01', '2026-06-02', '')).toBe(true)
    })
  })

  describe('isDeadlineNearby', () => {
    it('includes a deadline inside the window', () => {
      expect(isDeadlineNearby('2026-06-20T00:00:00Z', NOW)).toBe(true)
    })

    it('excludes a deadline far outside the window', () => {
      expect(isDeadlineNearby('2027-01-01T00:00:00Z', NOW)).toBe(false)
    })

    it('always includes tasks with no/invalid deadline (never hidden)', () => {
      expect(isDeadlineNearby(null, NOW)).toBe(true)
      expect(isDeadlineNearby(undefined, NOW)).toBe(true)
      expect(isDeadlineNearby('not-a-date', NOW)).toBe(true)
    })
  })
})
