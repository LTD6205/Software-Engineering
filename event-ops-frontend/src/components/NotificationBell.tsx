'use client'
import { useState, useRef, useEffect } from 'react'
import { Bell, CheckCheck, AlertTriangle, Clock, Calendar, CheckSquare, ArrowRightLeft, Info, History } from 'lucide-react'
import { useNotifications } from '@/lib/useNotifications'
import { useLang } from '@/context/LanguageContext'
import { Notification } from '@/lib/types'

type T = (en: string, vi: string) => string

function timeAgo(d: string, t: T) {
  const diff = Date.now() - new Date(d).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return t('Just now', 'Vừa xong')
  if (m < 60) return t(`${m}m ago`, `${m} phút trước`)
  const h = Math.floor(m / 60)
  if (h < 24) return t(`${h}h ago`, `${h} giờ trước`)
  return t(`${Math.floor(h / 24)}d ago`, `${Math.floor(h / 24)} ngày trước`)
}

const typeIcon: Partial<Record<Notification['type'], React.ReactNode>> = {
  reminder:     <Clock          size={14} color="var(--accent-blue)"   />,
  alert:        <AlertTriangle  size={14} color="var(--accent-amber)"  />,
  overdue:      <AlertTriangle  size={14} color="var(--accent-red)"    />,
  event:        <Calendar       size={14} color="var(--accent-blue)"   />,
  task:         <CheckSquare    size={14} color="var(--accent-teal)"   />,
  reassignment: <ArrowRightLeft size={14} color="var(--accent-purple)" />,
  info:         <Info           size={14} color="var(--text-muted)"    />,
}
const fallbackIcon = <Info size={14} color="var(--text-muted)" />

export default function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead, showHistory, setShowHistory } = useNotifications()
  const { t, tError } = useLang()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close when clicking outside the dropdown.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          width: '38px', height: '38px', borderRadius: '10px',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          position: 'relative',
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

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '46px', width: '340px',
          maxHeight: '440px', background: 'var(--bg-card)',
          border: '1px solid var(--border-light)', borderRadius: '12px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.4)', zIndex: 50,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
          }}>
            <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {t('Notifications', 'Thông báo')}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginRight: '4px' }}>
                {unreadCount} {t('unread', 'chưa đọc')}
              </span>
              {/* Mark all as read */}
              <button
                onClick={markAllRead}
                disabled={unreadCount === 0}
                title={t('Mark all as read', 'Đánh dấu tất cả đã đọc')}
                style={{
                  background: 'none', border: 'none', display: 'flex', padding: '5px', borderRadius: '6px',
                  cursor: unreadCount === 0 ? 'default' : 'pointer',
                  color: unreadCount === 0 ? 'var(--text-muted)' : 'var(--accent-green)',
                  opacity: unreadCount === 0 ? 0.4 : 1,
                }}>
                <CheckCheck size={16} />
              </button>
              {/* Toggle history (all vs unread only) */}
              <button
                onClick={() => setShowHistory(h => !h)}
                title={showHistory ? t('Show unread only', 'Chỉ hiện chưa đọc') : t('Show all (history)', 'Hiện tất cả (lịch sử)')}
                style={{
                  background: showHistory ? 'var(--bg-hover)' : 'none', border: 'none',
                  display: 'flex', padding: '5px', borderRadius: '6px', cursor: 'pointer',
                  color: showHistory ? 'var(--accent-blue)' : 'var(--text-secondary)',
                }}>
                <History size={16} />
              </button>
            </div>
          </div>

          <div style={{ overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <Bell size={26} color="var(--text-muted)" style={{ margin: '0 auto 8px' }} />
                <p style={{ fontSize: '13px' }}>{t('No notifications yet', 'Chưa có thông báo nào')}</p>
              </div>
            ) : (
              notifications.map(n => (
                <div key={n.notification_id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: '10px',
                  padding: '10px 12px', borderRadius: '8px',
                  background: n.is_read ? 'transparent' : 'var(--bg-hover)',
                }}>
                  <div style={{
                    width: '26px', height: '26px', borderRadius: '7px', flexShrink: 0,
                    background: 'var(--bg-secondary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {typeIcon[n.type] ?? fallbackIcon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="selectable" style={{ fontSize: '12.5px', color: 'var(--text-primary)', lineHeight: 1.4 }}>{tError(n.message)}</p>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{timeAgo(n.created_at, t)}</p>
                  </div>
                  {!n.is_read && (
                    <button onClick={() => markRead(n.notification_id)}
                      title={t('Mark as read', 'Đánh dấu đã đọc')}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '2px', display: 'flex', flexShrink: 0, cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--accent-green)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}>
                      <CheckCheck size={15} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
