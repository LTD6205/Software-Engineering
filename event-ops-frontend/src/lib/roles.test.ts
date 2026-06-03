import { ROLE_COLOR, roleColorOf, roleLabelOf } from './roles'

// The bilingual t() helper: pick English here.
const en = (e: string, _v: string) => e
const vi = (_e: string, v: string) => v

describe('roles helpers', () => {
  describe('roleColorOf', () => {
    it('returns the matching colour for each known role', () => {
      expect(roleColorOf('admin')).toBe(ROLE_COLOR.admin)
      expect(roleColorOf('eventmanager')).toBe(ROLE_COLOR.eventmanager)
      expect(roleColorOf('manager')).toBe(ROLE_COLOR.manager)
      expect(roleColorOf('staff')).toBe(ROLE_COLOR.staff)
    })

    it('falls back to the staff colour for unknown/blank roles', () => {
      expect(roleColorOf('whoknows')).toBe(ROLE_COLOR.staff)
      expect(roleColorOf(null)).toBe(ROLE_COLOR.staff)
      expect(roleColorOf(undefined)).toBe(ROLE_COLOR.staff)
    })
  })

  describe('roleLabelOf', () => {
    it('returns English labels', () => {
      expect(roleLabelOf('admin', en)).toBe('Admin')
      expect(roleLabelOf('eventmanager', en)).toBe('Event Manager')
      expect(roleLabelOf('manager', en)).toBe('Manager')
      expect(roleLabelOf('staff', en)).toBe('Staff')
    })

    it('returns Vietnamese labels', () => {
      expect(roleLabelOf('eventmanager', vi)).toBe('Quản lý sự kiện')
      expect(roleLabelOf('admin', vi)).toBe('Quản trị viên')
    })

    it('defaults unknown roles to the Staff label', () => {
      expect(roleLabelOf('mystery', en)).toBe('Staff')
      expect(roleLabelOf(null, en)).toBe('Staff')
    })
  })
})
