'use client'
import { useEffect, useState } from 'react'
import { Plus, CalendarDays } from 'lucide-react'
import { eventsApi, getErrorMessage } from '@/lib/api'
import { Event } from '@/lib/types'
import TopBar from '@/components/TopBar'
import EventCard from '@/components/EventCard'
import Modal from '@/components/Modal'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { useLang } from '@/context/LanguageContext'

const empty = {
  event_name: '', description: '',
  startDate: '', startTime: '', endDate: '', endTime: '',
  status: 'pending',
}

export default function EventsPage() {
  const [events, setEvents]       = useState<Event[]>([])
  const [loading, setLoading]     = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm]           = useState({ ...empty })
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const router = useRouter()
  const { user, isManager } = useAuth()
  const { t, tError } = useLang()

  const load = async () => {
    setLoading(true)
    try { setEvents(await eventsApi.getAll()) } finally { setLoading(false) }
  }

  useEffect(() => {
    eventsApi.getAll().then(setEvents).finally(() => setLoading(false))
  }, [])

  const handleCreate = async () => {
    if (!form.event_name || !form.startDate || !form.endDate) {
      setError(t('Event name, start date and end date are required', 'Vui lòng nhập tên sự kiện, ngày bắt đầu và ngày kết thúc'))
      return
    }
    // Combine date + time (default 08:00 if a time wasn't set).
    const start_time = `${form.startDate}T${form.startTime || '08:00'}`
    const end_time = `${form.endDate}T${form.endTime || '08:00'}`
    if (new Date(end_time) <= new Date(start_time)) {
      setError(t('End time must be after start time', 'Thời gian kết thúc phải sau thời gian bắt đầu'))
      return
    }
    setSaving(true); setError('')
    try {
      await eventsApi.create({
        event_name: form.event_name,
        description: form.description,
        status: form.status,
        start_time, end_time,
        created_by: user?.user_id,
      })
      setShowModal(false)
      setForm({ ...empty })
      load()
    } catch (e) {
      setError(tError(getErrorMessage(e, 'Could not create the event / Không thể tạo sự kiện')))
    } finally { setSaving(false) }
  }

  // A Date + Time row. Picking a date defaults the time to 08:00 (editable).
  const dateTimeRow = (
    labelEn: string, labelVi: string,
    dateKey: 'startDate' | 'endDate', timeKey: 'startTime' | 'endTime',
  ) => (
    <div style={{ marginBottom: '16px' }}>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
        {t(labelEn, labelVi)}
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '12px' }}>
        <div>
          <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>{t('Date', 'Ngày')}</span>
          <input
            type="date"
            value={form[dateKey]}
            onChange={e => {
              const val = e.target.value
              setForm(f => ({ ...f, [dateKey]: val, [timeKey]: f[timeKey] || (val ? '08:00' : '') }))
            }}
          />
        </div>
        <div>
          <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>{t('Time', 'Giờ')}</span>
          <input
            type="time"
            value={form[timeKey]}
            onChange={e => setForm(f => ({ ...f, [timeKey]: e.target.value }))}
          />
        </div>
      </div>
    </div>
  )

  const handleDelete = async (id: string) => {
    if (!confirm(t('Delete this event? This cannot be undone.', 'Xóa sự kiện này? Hành động không thể hoàn tác.'))) return
    await eventsApi.remove(id)
    setEvents(prev => prev.filter(e => e.event_id !== id))
  }

  const field = (label: string, labelVi: string, key: keyof typeof form, type = 'text') => (
    <div style={{ marginBottom: '16px' }}>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
        {t(label, labelVi)}
      </label>
      <input
        type={type}
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
      />
    </div>
  )

  return (
    <div>
      <TopBar title="Events" titleVi="Sự kiện" />
      <div style={{ padding: '28px' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {events.length} {t(events.length === 1 ? 'event total' : 'events total', 'sự kiện')}
          </p>
          {isManager && (
            <button
              onClick={() => setShowModal(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                background: 'var(--accent-blue)', color: 'white',
                border: 'none', borderRadius: '9px',
                padding: '9px 18px', fontSize: '13px', fontWeight: 600,
              }}>
              <Plus size={15} /> {t('New Event', 'Tạo sự kiện')}
            </button>
          )}
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>{t('Loading...', 'Đang tải...')}</p>
        ) : events.length === 0 ? (
          <div style={{
            background: 'var(--bg-card)', border: '1px dashed var(--border-light)',
            borderRadius: '12px', padding: '60px', textAlign: 'center',
          }}>
            <CalendarDays size={36} color="var(--text-muted)" style={{ margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '15px', fontWeight: 600 }}>{t('No events yet', 'Chưa có sự kiện nào')}</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '6px' }}>
              {t('Click "New Event" to create your first event', 'Nhấn "Tạo sự kiện" để tạo sự kiện đầu tiên')}
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: '12px' }}>
            {events.map(event => (
              <EventCard
                key={event.event_id}
                event={event}
                onDelete={handleDelete}
                onClick={e => router.push(`/tasks?eventId=${e.event_id}`)}
                canDelete={isManager}
              />
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <Modal title={t('Create New Event', 'Tạo sự kiện mới')} onClose={() => { setShowModal(false); setError('') }}>
          {field('Event Name', 'Tên sự kiện', 'event_name')}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {t('Description', 'Mô tả')}
            </label>
            <textarea
              rows={3}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              style={{ resize: 'vertical' }}
            />
          </div>
          {dateTimeRow('Start', 'Bắt đầu', 'startDate', 'startTime')}
          {dateTimeRow('End',   'Kết thúc', 'endDate',  'endTime')}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {t('Status', 'Trạng thái')}
            </label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="pending">{t('Pending', 'Chờ xử lý')}</option>
              <option value="in_progress">{t('In Progress', 'Đang làm')}</option>
              {/* A new event can't be created already 'completed'. */}
            </select>
          </div>
          {error && <p style={{ color: 'var(--accent-red)', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setShowModal(false); setError('') }}
              style={{
                background: 'var(--bg-hover)', color: 'var(--text-secondary)',
                border: '1px solid var(--border)', borderRadius: '8px',
                padding: '9px 18px', fontSize: '13px',
              }}>
              {t('Cancel', 'Hủy')}
            </button>
            <button
              onClick={handleCreate}
              disabled={saving}
              style={{
                background: 'var(--accent-blue)', color: 'white',
                border: 'none', borderRadius: '8px',
                padding: '9px 18px', fontSize: '13px', fontWeight: 600,
                opacity: saving ? 0.6 : 1,
              }}>
              {saving ? t('Creating...', 'Đang tạo...') : t('Create Event', 'Tạo sự kiện')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
