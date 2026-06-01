'use client'
import { useAuth } from '@/context/AuthContext'
import { useLang } from '@/context/LanguageContext'
import LangToggle from './LangToggle'
import NotificationBell from './NotificationBell'

interface Props { title: string; titleVi: string }

export default function TopBar({ title, titleVi }: Props) {
  const { user } = useAuth()
  const { t } = useLang()

  const roleLabel =
    user?.role === 'manager' ? t('Manager', 'Quản lý')
    : user?.role === 'admin' ? t('Admin', 'Quản trị viên')
    : t('Staff', 'Nhân viên')

  return (
    <div style={{
      height: '64px', background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 28px', position: 'sticky', top: 0, zIndex: 30,
    }}>
      <div>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{t(title, titleVi)}</h1>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <LangToggle />
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          {user?.name} · <span style={{ color: 'var(--text-muted)' }}>{roleLabel}</span>
        </p>
        <NotificationBell />
      </div>
    </div>
  )
}
