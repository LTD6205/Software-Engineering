// Single source of truth for role colours and labels across the UI, so they
// never drift apart again.
// Level order: Admin (red) > Organizer (purple) > Manager (orange/amber) > Staff (green).
export const ROLE_COLOR: Record<string, string> = {
  admin:        'var(--accent-red)',
  organizer:    'var(--accent-purple)',
  manager:      'var(--accent-amber)',
  staff:        'var(--accent-green)',
}

// Colour for a role, falling back to the staff colour for unknown/blank roles.
export function roleColorOf(role?: string | null): string {
  return (role && ROLE_COLOR[role]) || ROLE_COLOR.staff
}

// Bilingual role label. Pass the t(en, vi) helper from LanguageContext.
export function roleLabelOf(
  role: string | null | undefined,
  t: (en: string, vi: string) => string,
): string {
  switch (role) {
    case 'admin':        return t('Admin', 'Quản trị viên')
    case 'organizer':    return t('Organizer', 'Người tổ chức')
    case 'manager':      return t('Manager', 'Quản lý')
    default:             return t('Staff', 'Nhân viên')
  }
}
