'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, CalendarDays, CheckSquare, Bot, Users, LogOut } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useLang } from '@/context/LanguageContext'
import Avatar from './Avatar'

export default function Sidebar() {
  const path = usePathname()
  const { user, logout, isManager } = useAuth()
  const { t } = useLang()

  const roleLabel =
    user?.role === 'manager' ? t('Manager', 'Quản lý')
    : user?.role === 'admin' ? t('Admin', 'Quản trị viên')
    : t('Staff', 'Nhân viên')

  // Role colour by level: Admin (red) > Manager (yellow) > Staff (green).
  const roleColor =
    user?.role === 'admin' ? 'var(--accent-red)'
    : user?.role === 'manager' ? 'var(--accent-amber)'
    : 'var(--accent-green)'

  const nav = [
    { href: '/',              icon: LayoutDashboard, label: t('Dashboard', 'Tổng quan'),      show: true },
    { href: '/events',        icon: CalendarDays,    label: t('Events', 'Sự kiện'),           show: true },
    { href: '/tasks',         icon: CheckSquare,     label: t('Tasks', 'Công việc'),          show: true },
    { href: '/ai',            icon: Bot,             label: t('AI Assistant', 'Trợ lý AI'),   show: isManager },
    { href: '/users',         icon: Users,           label: t('Team', 'Nhân viên'),           show: true },
  ]

  return (
    <aside style={{
      width: '240px', minHeight: '100vh',
      background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 40,
    }}>
      <div style={{ padding: '20px', borderBottom: '1px solid var(--border)' }}>
        <Link href="/" style={{ textDecoration: 'none' }} title={t('Go to Dashboard', 'Về Tổng quan')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <div style={{
              width: '34px', height: '34px', borderRadius: '8px',
              background: 'var(--accent-blue)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <CalendarDays size={18} color="white" />
            </div>
            <div>
              <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>Event Ops</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{t('Management System', 'Hệ thống quản lý')}</p>
            </div>
          </div>
        </Link>
      </div>

      <nav style={{ flex: 1, padding: '12px 10px' }}>
        <p style={{
          fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)',
          letterSpacing: '0.1em', textTransform: 'uppercase', padding: '8px 10px 6px',
        }}>{t('Menu', 'Danh mục')}</p>
        {nav.filter(n => n.show).map(({ href, icon: Icon, label }) => {
          const active = path === href
          return (
            <Link key={href} href={href} style={{ textDecoration: 'none' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '9px 10px', borderRadius: '8px', marginBottom: '2px',
                background: active ? 'var(--bg-hover)' : 'transparent',
                border: active ? '1px solid var(--border-light)' : '1px solid transparent',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                <Icon size={16} color={active ? 'var(--accent-blue)' : 'var(--text-secondary)'} />
                <div>
                  <p style={{ fontSize: '13px', fontWeight: active ? 600 : 400, color: active ? 'var(--text-primary)' : 'var(--text-secondary)', lineHeight: 1.2 }}>{label}</p>
                </div>
              </div>
            </Link>
          )
        })}
      </nav>

      {/* User info + logout */}
      <div style={{ padding: '12px 10px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', marginBottom: '4px' }}>
          {/* Avatar (or default icon) with a role-coloured active bubble */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <Avatar src={user?.avatar} size={36} radius={9} />
            <span style={{
              position: 'absolute', bottom: '-2px', right: '-2px',
              width: '11px', height: '11px', borderRadius: '50%',
              background: roleColor, border: '2px solid var(--bg-secondary)',
            }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{user?.name}</p>
            <p style={{ fontSize: '11px', color: roleColor, fontWeight: 600 }}>{roleLabel}</p>
          </div>
        </div>
        <div
          onClick={logout}
          style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '9px 10px', borderRadius: '8px', cursor: 'pointer',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
          <LogOut size={16} color="var(--accent-red)" />
          <p style={{ fontSize: '13px', color: 'var(--accent-red)' }}>{t('Sign Out', 'Đăng xuất')}</p>
        </div>
      </div>
    </aside>
  )
}