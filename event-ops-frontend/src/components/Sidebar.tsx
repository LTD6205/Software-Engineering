'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, CalendarDays, CheckSquare, Bell, Bot, Settings } from 'lucide-react'

const nav = [
  { href: '/',              icon: LayoutDashboard, label: 'Dashboard',     vi: 'Tổng quan' },
  { href: '/events',        icon: CalendarDays,    label: 'Events',        vi: 'Sự kiện' },
  { href: '/tasks',         icon: CheckSquare,     label: 'Tasks',         vi: 'Công việc' },
  { href: '/notifications', icon: Bell,            label: 'Notifications', vi: 'Thông báo' },
  { href: '/ai',            icon: Bot,             label: 'AI Assistant',  vi: 'Trợ lý AI' },
]

export default function Sidebar() {
  const path = usePathname()
  return (
    <aside style={{
      width: '240px', minHeight: '100vh',
      background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 40,
    }}>
      <div style={{ padding: '20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '34px', height: '34px', borderRadius: '8px',
            background: 'var(--accent-blue)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <CalendarDays size={18} color="white" />
          </div>
          <div>
            <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>Event Ops</p>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Management System</p>
          </div>
        </div>
      </div>
      <nav style={{ flex: 1, padding: '12px 10px' }}>
        <p style={{
          fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)',
          letterSpacing: '0.1em', textTransform: 'uppercase', padding: '8px 10px 6px',
        }}>Menu</p>
        {nav.map(({ href, icon: Icon, label, vi }) => {
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
                  <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{vi}</p>
                </div>
              </div>
            </Link>
          )
        })}
      </nav>
      <div style={{ padding: '12px 10px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 10px' }}>
          <Settings size={16} color="var(--text-muted)" />
          <div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Settings</p>
            <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Cài đặt</p>
          </div>
        </div>
      </div>
    </aside>
  )
}