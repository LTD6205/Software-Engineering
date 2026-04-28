'use client'
import { Bell } from 'lucide-react'
import Link from 'next/link'
import { useNotifications } from '@/lib/useNotifications'

interface Props { title: string; titleVi: string }

export default function TopBar({ title, titleVi }: Props) {
  const { unreadCount } = useNotifications()
  return (
    <div style={{
      height: '64px', background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 28px', position: 'sticky', top: 0, zIndex: 30,
    }}>
      <div>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{title}</h1>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{titleVi}</p>
      </div>
      <Link href="/notifications" style={{ textDecoration: 'none', position: 'relative' }}>
        <div style={{
          width: '38px', height: '38px', borderRadius: '10px',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}>
          <Bell size={17} color="var(--text-secondary)" />
          {unreadCount > 0 && (
            <span style={{
              position: 'absolute', top: '-4px', right: '-4px',
              background: 'var(--accent-red)', color: 'white',
              fontSize: '10px', fontWeight: 700,
              width: '18px', height: '18px', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </div>
      </Link>
    </div>
  )
}