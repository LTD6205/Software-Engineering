'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus, CalendarDays } from 'lucide-react'
import { eventsApi, getErrorMessage } from '@/lib/api'
import { useLiveData } from '@/lib/useLiveData'
import { isEventNearby, isEventInMonth, isEventOnDate, NEARBY_DAYS } from '@/lib/filters'
import { Event, ManagerOption } from '@/lib/types'
import TopBar from '@/components/TopBar'
import EventCard from '@/components/EventCard'
import Dropdown from '@/components/Dropdown'
import Modal from '@/components/Modal'
import ConfirmDialog from '@/components/ConfirmDialog'
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
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [managers, setManagers] = useState<ManagerOption[]>([])
  const [pickedManagers, setPickedManagers] = useState<string[]>([])
  const [editing, setEditing] = useState<Event | null>(null) // member editor
  const [memberIds, setMemberIds] = useState<string[]>([])
  // Date editor.
  const [editingDates, setEditingDates] = useState<Event | null>(null)
  const [dForm, setDForm] = useState({ startDate: '', startTime: '', endDate: '', endTime: '' })
  const [dErr, setDErr] = useState('')
  const [dSaving, setDSaving] = useState(false)
  // Details editor (name + optional description).
  const [editingDetails, setEditingDetails] = useState<Event | null>(null)
  const [detForm, setDetForm] = useState({ event_name: '', description: '' })
  const [detErr, setDetErr] = useState('')
  const [detSaving, setDetSaving] = useState(false)
  // Filters — time scope (default "all") + status. The month/date pickers start
  // on the current month / today so they never show an empty "----------" mask.
  const [timeScope, setTimeScope] = useState<'all' | 'nearby' | 'month' | 'date'>('all')
  const [monthVal, setMonthVal] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [dateVal, setDateVal] = useState(() => {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  })
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all')
  const router = useRouter()
  const { canManageEvents } = useAuth()
  const { t, tError } = useLang()

  // Split an ISO timestamp into local date + time inputs.
  const splitDT = (iso: string) => {
    const d = new Date(iso)
    const p = (n: number) => String(n).padStart(2, '0')
    return {
      date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
      time: `${p(d.getHours())}:${p(d.getMinutes())}`,
    }
  }

  const load = async () => {
    setLoading(true)
    try { setEvents(await eventsApi.getAll()) } catch { /* backend down */ } finally { setLoading(false) }
  }

  useEffect(() => {
    eventsApi.getAll().then(setEvents).catch(() => {}).finally(() => setLoading(false))
    if (canManageEvents) eventsApi.availableManagers().then(setManagers).catch(() => {})
  }, [canManageEvents])

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter(x => x !== id) : [...list, id]

  // Live updates: refetch the event list (status badges + milestones) whenever
  // anyone changes a task or event, no manual reload needed.
  const liveRefresh = useCallback(() => {
    eventsApi.getAll().then(setEvents).catch(() => {})
  }, [])
  useLiveData(liveRefresh)

  const handleCreate = async () => {
    if (!form.event_name || !form.startDate || !form.endDate) {
      setError(t('Event name, start date and end date are required', 'Vui lòng nhập tên sự kiện, ngày bắt đầu và ngày kết thúc'))
      return
    }
    if (pickedManagers.length === 0) {
      setError(t('Select at least one manager', 'Chọn ít nhất một quản lý'))
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
        status: 'pending', // always starts pending; driven by its tasks afterward
        start_time, end_time,
        manager_ids: pickedManagers,
      })
      setShowModal(false)
      setForm({ ...empty })
      setPickedManagers([])
      load()
    } catch (e) {
      setError(tError(getErrorMessage(e, 'Could not create the event / Không thể tạo sự kiện')))
    } finally { setSaving(false) }
  }

  // Member editor: open, then add/remove managers (their staff follow).
  const openMembers = async (ev: Event) => {
    setEditing(ev)
    try {
      const ms = await eventsApi.getManagers(ev.event_id)
      setMemberIds(ms.map((m: ManagerOption) => m.user_id))
    } catch { setMemberIds([]) }
  }
  const toggleMember = async (managerId: string) => {
    if (!editing) return
    const isIn = memberIds.includes(managerId)
    setMemberIds(prev => toggle(prev, managerId)) // optimistic
    try {
      if (isIn) await eventsApi.removeManager(editing.event_id, managerId)
      else await eventsApi.addManager(editing.event_id, managerId)
      load() // refresh headcounts
    } catch {
      setMemberIds(prev => toggle(prev, managerId)) // revert
    }
  }

  // Date editor: open prefilled, then save with a task strategy.
  const openDateEditor = (ev: Event) => {
    const s = splitDT(ev.start_time)
    const e = splitDT(ev.end_time)
    setDForm({ startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time })
    setEditingDates(ev)
    setDErr('')
  }
  const submitDates = async (strategy: 'delete' | 'shift') => {
    if (!editingDates) return
    if (!dForm.startDate || !dForm.startTime || !dForm.endDate || !dForm.endTime) {
      setDErr(t('All date and time fields are required', 'Vui lòng nhập đầy đủ ngày và giờ')); return
    }
    const startLocal = `${dForm.startDate}T${dForm.startTime}`
    const endLocal = `${dForm.endDate}T${dForm.endTime}`
    if (new Date(endLocal) <= new Date(startLocal)) {
      setDErr(t('End time must be after start time', 'Thời gian kết thúc phải sau thời gian bắt đầu')); return
    }
    setDSaving(true); setDErr('')
    try {
      await eventsApi.updateDates(editingDates.event_id, {
        start_time: new Date(startLocal).toISOString(),
        end_time: new Date(endLocal).toISOString(),
        task_strategy: strategy,
      })
      setEditingDates(null)
      load()
    } catch (e) {
      setDErr(tError(getErrorMessage(e, 'Could not update the dates / Không thể cập nhật thời gian')))
    } finally { setDSaving(false) }
  }

  // Details editor: open prefilled with the current name + description.
  const openDetailsEditor = (ev: Event) => {
    setDetForm({ event_name: ev.event_name, description: ev.description || '' })
    setEditingDetails(ev)
    setDetErr('')
  }
  const submitDetails = async () => {
    if (!editingDetails) return
    if (!detForm.event_name.trim()) {
      setDetErr(t('Event name is required', 'Vui lòng nhập tên sự kiện')); return
    }
    setDetSaving(true); setDetErr('')
    try {
      await eventsApi.update(editingDetails.event_id, {
        event_name: detForm.event_name.trim(),
        description: detForm.description.trim() || null,
      })
      setEditingDetails(null)
      load()
    } catch (e) {
      setDetErr(tError(getErrorMessage(e, 'Could not update the event / Không thể cập nhật sự kiện')))
    } finally { setDetSaving(false) }
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

  const doDelete = async (id: string) => {
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

  // Apply the active filters (status + time scope) to the visible events.
  const filteredEvents = events.filter(ev => {
    if (statusFilter !== 'all' && ev.status !== statusFilter) return false
    if (timeScope === 'nearby') return isEventNearby(ev.start_time, ev.end_time)
    if (timeScope === 'month')  return isEventInMonth(ev.start_time, ev.end_time, monthVal)
    if (timeScope === 'date')   return isEventOnDate(ev.start_time, ev.end_time, dateVal)
    return true // 'all'
  })
  const resetFilters = () => { setTimeScope('all'); setStatusFilter('all'); setMonthVal(''); setDateVal('') }

  // A small pill button used by the filter bar.
  const pill = (active: boolean, label: string, onClick: () => void) => (
    <button onClick={onClick} style={{
      fontSize: '12px', fontWeight: 600, padding: '6px 12px', borderRadius: '8px', cursor: 'pointer',
      background: active ? 'var(--accent-blue)' : 'var(--bg-card)',
      color: active ? 'white' : 'var(--text-secondary)',
      border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border)'}`,
    }}>{label}</button>
  )

  return (
    <div>
      <TopBar title="Events" titleVi="Sự kiện" />
      <div style={{ padding: '28px' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {filteredEvents.length}{filteredEvents.length !== events.length ? ` / ${events.length}` : ''}{' '}
            {t(events.length === 1 ? 'event' : 'events', 'sự kiện')}
          </p>
          {canManageEvents && (
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

        {/* Filter bar: time scope (default Nearby) + status. */}
        {!loading && events.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
            {pill(timeScope === 'all', t('All', 'Tất cả'), () => setTimeScope('all'))}
            {pill(timeScope === 'nearby', t('Nearby', 'Gần đây'), () => setTimeScope('nearby'))}
            {pill(timeScope === 'month', t('Month', 'Tháng'), () => setTimeScope('month'))}
            {pill(timeScope === 'date', t('Date', 'Ngày'), () => setTimeScope('date'))}
            {timeScope === 'month' && (
              <input type="month" value={monthVal} onChange={e => setMonthVal(e.target.value)}
                style={{ width: 'auto', padding: '6px 10px', fontSize: '12px' }} />
            )}
            {timeScope === 'date' && (
              <input type="date" value={dateVal} onChange={e => setDateVal(e.target.value)}
                style={{ width: 'auto', padding: '6px 10px', fontSize: '12px' }} />
            )}
            <span style={{ width: '1px', height: '20px', background: 'var(--border)', margin: '0 4px' }} />
            <Dropdown size="sm" value={statusFilter} onChange={v => setStatusFilter(v as typeof statusFilter)}
              ariaLabel={t('Filter by status', 'Lọc theo trạng thái')}
              options={[
                { value: 'all', label: t('All statuses', 'Mọi trạng thái') },
                { value: 'pending', label: t('Pending', 'Chờ xử lý'), color: 'var(--accent-amber)' },
                { value: 'in_progress', label: t('In Progress', 'Đang làm'), color: 'var(--accent-blue)' },
                { value: 'completed', label: t('Completed', 'Hoàn thành'), color: 'var(--accent-green)' },
              ]} />
            {timeScope === 'nearby' && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {t(`±${NEARBY_DAYS} days around today`, `±${NEARBY_DAYS} ngày quanh hôm nay`)}
              </span>
            )}
          </div>
        )}

        {loading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>{t('Loading...', 'Đang tải...')}</p>
        ) : events.length === 0 ? (
          <div style={{
            background: 'var(--bg-card)', border: '1px dashed var(--border-light)',
            borderRadius: '12px', padding: '60px', textAlign: 'center',
          }}>
            <CalendarDays size={36} color="var(--text-muted)" style={{ margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '15px', fontWeight: 600 }}>{t('No events yet', 'Chưa có sự kiện nào')}</p>
            {/* Only those who can create events get the "create your first" hint. */}
            {canManageEvents ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '6px' }}>
                {t('Click "New Event" to create your first event', 'Nhấn "Tạo sự kiện" để tạo sự kiện đầu tiên')}
              </p>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '6px' }}>
                {t('You will see events here once you are added to one', 'Bạn sẽ thấy sự kiện ở đây khi được thêm vào')}
              </p>
            )}
          </div>
        ) : filteredEvents.length === 0 ? (
          <div style={{
            background: 'var(--bg-card)', border: '1px dashed var(--border-light)',
            borderRadius: '12px', padding: '50px', textAlign: 'center',
          }}>
            <CalendarDays size={36} color="var(--text-muted)" style={{ margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '15px', fontWeight: 600 }}>{t('No events match this filter', 'Không có sự kiện khớp bộ lọc')}</p>
            <button onClick={resetFilters} style={{
              marginTop: '12px', background: 'var(--accent-blue)', color: 'white', border: 'none',
              borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}>{t('Show all events', 'Hiện tất cả sự kiện')}</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: '12px' }}>
            {filteredEvents.map(event => (
              <EventCard
                key={event.event_id}
                event={event}
                onDelete={setPendingDelete}
                onClick={e => router.push(`/tasks?eventId=${e.event_id}`)}
                canDelete={canManageEvents}
                onManageMembers={canManageEvents ? openMembers : undefined}
                onEditDates={canManageEvents ? openDateEditor : undefined}
                onEditDetails={canManageEvents ? openDetailsEditor : undefined}
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
              {t('Description', 'Mô tả')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({t('optional', 'không bắt buộc')})</span>
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

          {/* Managers assigned to this event — they and all their staff become
              members and contribute to the headcount. */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {t('Managers', 'Quản lý')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                ({t('and their teams', 'và đội của họ')})
              </span>
            </label>
            <div style={{
              maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px',
              border: '1px solid var(--border)', borderRadius: '8px', padding: '8px',
            }}>
              {managers.length === 0 ? (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '6px' }}>
                  {t('No managers available', 'Không có quản lý nào')}
                </span>
              ) : managers.map(mgr => {
                const checked = pickedManagers.includes(mgr.user_id)
                return (
                  <label key={mgr.user_id} style={{
                    display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 9px', borderRadius: '7px',
                    cursor: 'pointer', background: checked ? 'var(--bg-hover)' : 'transparent', fontSize: '13px',
                  }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setPickedManagers(prev => toggle(prev, mgr.user_id))}
                      style={{ width: 'auto', margin: 0 }}
                    />
                    <span style={{ flex: 1, color: 'var(--text-primary)' }}>{mgr.name}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {mgr.team_count} {t(mgr.team_count === 1 ? 'staff' : 'staff', 'nhân viên')}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
          {/* No status field — a new event always starts as "pending" and its
              status is then driven automatically by its tasks. */}
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

      {editing && (
        <Modal
          title={t('Manage members', 'Quản lý thành viên') + ' — ' + editing.event_name}
          onClose={() => { setEditing(null); setMemberIds([]) }}
        >
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
            {t(
              'Add or remove managers. Each manager brings their whole team into the event.',
              'Thêm hoặc bớt quản lý. Mỗi quản lý sẽ đưa cả đội của họ vào sự kiện.',
            )}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '320px', overflowY: 'auto' }}>
            {managers.length === 0 ? (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '6px' }}>
                {t('No managers available', 'Không có quản lý nào')}
              </span>
            ) : managers.map(mgr => {
              const inEvent = memberIds.includes(mgr.user_id)
              return (
                <label key={mgr.user_id} style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 11px', borderRadius: '8px',
                  cursor: 'pointer', background: inEvent ? 'var(--bg-hover)' : 'transparent',
                  border: '1px solid var(--border)', fontSize: '13px',
                }}>
                  <input
                    type="checkbox"
                    checked={inEvent}
                    onChange={() => toggleMember(mgr.user_id)}
                    style={{ width: 'auto', margin: 0 }}
                  />
                  <span style={{ flex: 1, color: 'var(--text-primary)' }}>{mgr.name}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {mgr.team_count} {t('staff', 'nhân viên')}
                  </span>
                </label>
              )
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button
              onClick={() => { setEditing(null); setMemberIds([]) }}
              style={{
                background: 'var(--accent-blue)', color: 'white', border: 'none', borderRadius: '8px',
                padding: '9px 18px', fontSize: '13px', fontWeight: 600,
              }}>
              {t('Done', 'Xong')}
            </button>
          </div>
        </Modal>
      )}

      {/* Date editor — change an event's dates and decide what happens to tasks. */}
      {editingDates && (
        <Modal
          title={t('Change dates', 'Đổi thời gian') + ' — ' + editingDates.event_name}
          onClose={() => setEditingDates(null)}
        >
          {(['start', 'end'] as const).map(which => {
            const dateKey = which === 'start' ? 'startDate' : 'endDate'
            const timeKey = which === 'start' ? 'startTime' : 'endTime'
            return (
              <div key={which} style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  {which === 'start' ? t('Start', 'Bắt đầu') : t('End', 'Kết thúc')}
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '12px' }}>
                  <input type="date" value={dForm[dateKey]}
                    onChange={e => setDForm(f => ({ ...f, [dateKey]: e.target.value }))} />
                  <input type="time" value={dForm[timeKey]}
                    onChange={e => setDForm(f => ({ ...f, [timeKey]: e.target.value }))} />
                </div>
              </div>
            )
          })}
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px', lineHeight: 1.5 }}>
            {t(
              'Choose what happens to this event’s tasks: shift them all by the same change (any task that ends past the new end date is removed), or delete them all.',
              'Chọn điều xảy ra với công việc của sự kiện: dời tất cả theo cùng mức thay đổi (công việc kết thúc sau ngày kết thúc mới sẽ bị xóa), hoặc xóa tất cả.',
            )}
          </p>
          {dErr && <p style={{ color: 'var(--accent-red)', fontSize: '13px', marginBottom: '12px' }}>{dErr}</p>}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button onClick={() => setEditingDates(null)} disabled={dSaving} style={{
              background: 'var(--bg-hover)', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', borderRadius: '8px', padding: '9px 16px', fontSize: '13px',
            }}>{t('Cancel', 'Hủy')}</button>
            <button onClick={() => submitDates('delete')} disabled={dSaving} style={{
              background: 'transparent', color: 'var(--accent-red)',
              border: '1px solid var(--accent-red)', borderRadius: '8px', padding: '9px 16px', fontSize: '13px', fontWeight: 600,
              opacity: dSaving ? 0.6 : 1,
            }}>{t('Delete all tasks', 'Xóa tất cả công việc')}</button>
            <button onClick={() => submitDates('shift')} disabled={dSaving} style={{
              background: 'var(--accent-blue)', color: 'white',
              border: 'none', borderRadius: '8px', padding: '9px 16px', fontSize: '13px', fontWeight: 600,
              opacity: dSaving ? 0.6 : 1,
            }}>{dSaving ? t('Saving...', 'Đang lưu...') : t('Shift tasks', 'Dời công việc')}</button>
          </div>
        </Modal>
      )}

      {/* Details editor — change the event's name and optional description. */}
      {editingDetails && (
        <Modal
          title={t('Edit event', 'Sửa sự kiện')}
          onClose={() => setEditingDetails(null)}
        >
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {t('Event Name', 'Tên sự kiện')}
            </label>
            <input
              type="text"
              value={detForm.event_name}
              onChange={e => setDetForm(f => ({ ...f, event_name: e.target.value }))}
            />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {t('Description', 'Mô tả')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({t('optional', 'không bắt buộc')})</span>
            </label>
            <textarea
              rows={4}
              value={detForm.description}
              onChange={e => setDetForm(f => ({ ...f, description: e.target.value }))}
              style={{ resize: 'vertical' }}
            />
          </div>
          {detErr && <p style={{ color: 'var(--accent-red)', fontSize: '13px', marginBottom: '12px' }}>{detErr}</p>}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button onClick={() => setEditingDetails(null)} disabled={detSaving} style={{
              background: 'var(--bg-hover)', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', borderRadius: '8px', padding: '9px 18px', fontSize: '13px',
            }}>{t('Cancel', 'Hủy')}</button>
            <button onClick={submitDetails} disabled={detSaving} style={{
              background: 'var(--accent-blue)', color: 'white',
              border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 600,
              opacity: detSaving ? 0.6 : 1,
            }}>{detSaving ? t('Saving...', 'Đang lưu...') : t('Save', 'Lưu')}</button>
          </div>
        </Modal>
      )}

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
