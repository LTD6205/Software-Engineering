'use client'
import { Bell, CheckCheck, AlertTriangle, Clock } from 'lucide-react'
import TopBar from '@/components/TopBar'
import { useNotifications } from '@/lib/useNotifications'
import { Notification } from '@/lib/types'

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'Just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const typeIcon: Record<Notification['type'], React.ReactNode> = {
  reminder: <Clock         size={15} color="var(--accent-blue)"  />,
  alert:    <AlertTriangle size={15} color="var(--accent-amber)" />,
  overdue:  <AlertTriangle size={15} color="var(--accent-red)"   />,
}

const typeBg: Record<Notification['type'], string> = {
  reminder: '#1e2d4a',
  alert:    '#2d2a1a',
  overdue:  '#3a1a1a',
}

export default function NotificationsPage() {
  const { notifications, unreadCount, markRead } = useNotifications()

  return (
    <div>
      <TopBar title="Notifications" titleVi="Thông báo" />
      <div style={{ padding: '28px', maxWidth: '700px' }}>

        <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
          {unreadCount} unread · {notifications.length} total
        </p>

        {notifications.length === 0 ? (
          <div style={{
            background: 'var(--bg-card)', border: '1px dashed var(--border-light)',
            borderRadius: '12px', padding: '60px', textAlign: 'center',
          }}>
            <Bell size={36} color="var(--text-muted)" style={{ margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '15px', fontWeight: 600 }}>No notifications yet</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '6px' }}>Chưa có thông báo nào</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {notifications.map(n => (
              <div key={n.notification_id} style={{
                background: n.is_read ? 'var(--bg-card)' : typeBg[n.type],
                border: `1px solid ${n.is_read ? 'var(--border)' : 'var(--border-light)'}`,
                borderRadius: '10px', padding: '14px 16px',
                display: 'flex', alignItems: 'flex-start', gap: '12px',
                opacity: n.is_read ? 0.6 : 1,
              }}>
                <div style={{
                  width: '32px', height: '32px', borderRadius: '8px',
                  background: 'var(--bg-hover)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {typeIcon[n.type]}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.4 }}>{n.message}</p>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{timeAgo(n.created_at)}</p>
                </div>
                {!n.is_read && (
                  <button onClick={() => markRead(n.notification_id)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '4px', borderRadius: '6px', display: 'flex', flexShrink: 0 }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--accent-green)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}>
                    <CheckCheck size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}