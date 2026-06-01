'use client'
import { useEffect, useState } from 'react'
import { CalendarDays, CheckSquare, AlertTriangle, Clock } from 'lucide-react'
import { eventsApi } from '@/lib/api'
import { Event } from '@/lib/types'
import TopBar from '@/components/TopBar'
import StatCard from '@/components/StatCard'
import EventCard from '@/components/EventCard'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useRouter } from 'next/navigation'
import { useLang } from '@/context/LanguageContext'
import { useAuth } from '@/context/AuthContext'

export default function DashboardPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const router = useRouter()
  const { t } = useLang()
  const { isManager } = useAuth()

  useEffect(() => {
    eventsApi.getAll()
      .then(setEvents)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const total     = events.length
  const active    = events.filter(e => e.status === 'in_progress').length
  const completed = events.filter(e => e.status === 'completed').length
  const pending   = events.filter(e => e.status === 'pending').length

  const doDelete = async (id: string) => {
    await eventsApi.remove(id)
    setEvents(prev => prev.filter(e => e.event_id !== id))
  }

  return (
    <div>
      <TopBar title="Dashboard" titleVi="Tổng quan" />
      <div style={{ padding: '28px' }}>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          marginBottom: '32px',
        }}>
          <StatCard label="Total Events"  labelVi="Tổng sự kiện"  value={total}     icon={CalendarDays}  color="var(--accent-blue)"  />
          <StatCard label="Active"        labelVi="Đang diễn ra"  value={active}    icon={Clock}         color="var(--accent-teal)"  />
          <StatCard label="Completed"     labelVi="Hoàn thành"    value={completed} icon={CheckSquare}   color="var(--accent-green)" />
          <StatCard label="Pending"       labelVi="Chờ xử lý"     value={pending}   icon={AlertTriangle} color="var(--accent-amber)" />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>{t('Recent Events', 'Sự kiện gần đây')}</h2>
          </div>
          <button
            onClick={() => router.push('/events')}
            style={{
              background: 'var(--accent-blue)', color: 'white',
              border: 'none', borderRadius: '8px',
              padding: '8px 16px', fontSize: '13px', fontWeight: 600,
            }}>
            {t('View all', 'Xem tất cả')}
          </button>
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>{t('Loading...', 'Đang tải...')}</p>
        ) : events.length === 0 ? (
          <div style={{
            background: 'var(--bg-card)', border: '1px dashed var(--border-light)',
            borderRadius: '12px', padding: '48px', textAlign: 'center',
          }}>
            <CalendarDays size={32} color="var(--text-muted)" style={{ margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{t('No events yet', 'Chưa có sự kiện nào')}</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px' }}>
              {t('Go to Events to create your first one', 'Vào mục Sự kiện để tạo sự kiện đầu tiên')}
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: '12px' }}>
            {events.slice(0, 6).map(event => (
              <EventCard
                key={event.event_id}
                event={event}
                onDelete={setPendingDelete}
                onClick={e => router.push(`/tasks?eventId=${e.event_id}`)}
                canDelete={isManager}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        danger
        title={t('Delete event', 'Xóa sự kiện')}
        message={t('Delete this event? This cannot be undone.', 'Xóa sự kiện này? Hành động không thể hoàn tác.')}
        confirmLabel={t('Delete', 'Xóa')}
        cancelLabel={t('Cancel', 'Hủy')}
        onConfirm={() => { if (pendingDelete) doDelete(pendingDelete); setPendingDelete(null) }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}