'use client'
import { useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useLang } from '@/context/LanguageContext'
import LangToggle from './LangToggle'
import NotificationBell from './NotificationBell'
import ProfileModal from './ProfileModal'

interface Props { title: string; titleVi: string }

export default function TopBar({ title, titleVi }: Props) {
  const { user } = useAuth()
  const { t } = useLang()
  const [showProfile, setShowProfile] = useState(false)

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
        {/* Click to open the personal profile editor */}
        <button
          onClick={() => setShowProfile(true)}
          title={t('Edit profile', 'Chỉnh sửa hồ sơ')}
          style={{
            background: 'transparent', border: '1px solid transparent', borderRadius: '8px',
            padding: '5px 10px', fontSize: '13px', color: 'var(--text-secondary)',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.borderColor = 'transparent' }}>
          {user?.name} · <span style={{ color: 'var(--text-muted)' }}>{roleLabel}</span>
        </button>
        <NotificationBell />
      </div>

      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
    </div>
  )
}
