'use client'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plus, CheckSquare } from 'lucide-react'
import { tasksApi, eventsApi, usersApi, getErrorMessage } from '@/lib/api'
import { Task, Event } from '@/lib/types'
import TopBar from '@/components/TopBar'
import TaskCard from '@/components/TaskCard'
import Modal from '@/components/Modal'
import Avatar from '@/components/Avatar'
import MilestoneBar from '@/components/MilestoneBar'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useAuth } from '@/context/AuthContext'
import { useLang } from '@/context/LanguageContext'

const emptyTask = {
  task_name: '', description: '',
  priority_label: 'medium',
  startDate: '', startTime: '', deadlineDate: '', deadlineTime: '',
  assigned_to: [] as string[],
}

// Format a stored timestamp to a local "YYYY-MM-DDTHH:mm" string.
function toLocalDateTime(v?: string) {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function TasksContent() {
  const searchParams = useSearchParams()
  const eventId      = searchParams.get('eventId') || ''
  const { user, isManager, isAdmin } = useAuth()
  const { t, tError } = useLang()

  const [events, setEvents]               = useState<Event[]>([])
  const [selectedEvent, setSelectedEvent] = useState(eventId)
  const [tasks, setTasks]                 = useState<Task[]>([])
  const [loading, setLoading]             = useState(false)
  const [showModal, setShowModal]         = useState(false)
  const [form, setForm]                   = useState({ ...emptyTask })
  const [saving, setSaving]               = useState(false)
  const [error, setError]                 = useState('')
  const [teamMembers, setTeamMembers]     = useState<{ user_id: string; name: string; role: string; manager_id?: string | null; avatar?: string | null }[]>([])
  const [pendingReopen, setPendingReopen] = useState<{ id: string; status: string } | null>(null)
  const [pendingTaskDelete, setPendingTaskDelete] = useState<string | null>(null)
  // Avatar re-select picker: the task whose assignees are being edited.
  const [editingAssignees, setEditingAssignees] = useState<Task | null>(null)
  const [pickedStaff, setPickedStaff] = useState<string[]>([])

  // Staff this manager may assign: their own team (admins may assign any staff).
  const assignableStaff = teamMembers.filter(
    m => m.role === 'staff' && (isAdmin || m.manager_id === user?.user_id),
  )
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter(x => x !== id) : [...list, id]

  useEffect(() => {
    eventsApi.getAll().then(setEvents).catch(() => {})
    if (isManager) {
      usersApi.getAll()
        .then(setTeamMembers)
        .catch(() => {})
    }
  }, [isManager])

  // Reload tasks whenever the selected event changes. setLoading(true) up front
  // is intentional so the spinner shows immediately while the fetch runs.
  useEffect(() => {
    if (!selectedEvent) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    tasksApi.getByEvent(selectedEvent)
      .then(setTasks)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [selectedEvent])

  // The task's dates must stay within the parent event's time range.
  const selEvent = events.find(e => e.event_id === selectedEvent)
  const evStart = toLocalDateTime(selEvent?.start_time) // "YYYY-MM-DDTHH:mm"
  const evEnd   = toLocalDateTime(selEvent?.end_time)

  const handleCreate = async () => {
    if (!selectedEvent) {
      setError(t('Please select an event', 'Vui lòng chọn sự kiện'))
      return
    }
    // Every field is required (at least one assignee).
    if (!form.task_name || !form.description || form.assigned_to.length === 0 ||
        !form.startDate || !form.startTime || !form.deadlineDate || !form.deadlineTime) {
      setError(t('Please fill in every field', 'Vui lòng điền tất cả các trường'))
      return
    }
    const start = `${form.startDate}T${form.startTime}`
    const deadline = `${form.deadlineDate}T${form.deadlineTime}`

    if (start && deadline && deadline <= start) {
      setError(t('Deadline must be after the start time', 'Hạn chót phải sau thời gian bắt đầu'))
      return
    }
    // Keep within the event window (string compare works for this format).
    const outside = (v: string) => evStart && evEnd && (v < evStart || v > evEnd)
    if ((start && outside(start)) || (deadline && outside(deadline))) {
      setError(t('Task dates must be within the event period', 'Thời gian công việc phải nằm trong thời gian sự kiện'))
      return
    }

    setSaving(true); setError('')
    try {
      const task = await tasksApi.create({
        task_name:      form.task_name,
        description:    form.description,
        priority_label: form.priority_label,
        priority_score: form.priority_label === 'high' ? 90 : form.priority_label === 'medium' ? 50 : 10,
        event_id:       selectedEvent,
        created_by:     user?.user_id || '',
        ...(deadline ? { deadline:   new Date(deadline).toISOString() }   : {}),
        ...(start    ? { start_time: new Date(start).toISOString() } : {}),
      })

      if (form.assigned_to.length > 0) {
        await tasksApi.setAssignees(task.task_id, form.assigned_to)
      }

      setShowModal(false)
      setForm({ ...emptyTask })
      setTasks(await tasksApi.getByEvent(selectedEvent))
    } catch (e) {
      setError(tError(getErrorMessage(e, 'Could not create the task / Không thể tạo công việc')))
    } finally { setSaving(false) }
  }

  // A Date + Time row constrained to the event's date range. Picking a date
  // defaults the time to 08:00 (editable).
  const dateTimeRow = (
    labelEn: string, labelVi: string,
    dateKey: 'startDate' | 'deadlineDate', timeKey: 'startTime' | 'deadlineTime',
  ) => (
    <div>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
        {t(labelEn, labelVi)}
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '8px' }}>
        <input
          type="date"
          value={form[dateKey]}
          min={evStart.slice(0, 10) || undefined}
          max={evEnd.slice(0, 10) || undefined}
          onChange={e => {
            const val = e.target.value
            setForm(f => ({ ...f, [dateKey]: val, [timeKey]: f[timeKey] || (val ? '08:00' : '') }))
          }}
        />
        <input
          type="time"
          value={form[timeKey]}
          onChange={e => setForm(f => ({ ...f, [timeKey]: e.target.value }))}
        />
      </div>
    </div>
  )

  // Optimistic status update; reverts (with a message) if the server rejects it.
  const applyStatus = async (id: string, status: string) => {
    const task = tasks.find(t => t.task_id === id)
    if (!task) return
    const prev = task.status
    setTasks(p => p.map(t => t.task_id === id ? { ...t, status: status as Task['status'] } : t))
    try {
      await tasksApi.update(id, { status })
    } catch (e) {
      setTasks(p => p.map(t => t.task_id === id ? { ...t, status: prev } : t))
      alert(tError(getErrorMessage(e, 'Could not update status / Không thể cập nhật trạng thái')))
    }
  }

  const handleStatusChange = (id: string, status: string) => {
    const task = tasks.find(t => t.task_id === id)
    if (!task || task.status === status) return
    // Reopening a completed task asks for confirmation first.
    if (task.status === 'completed' && status !== 'completed') {
      setPendingReopen({ id, status })
      return
    }
    void applyStatus(id, status)
  }

  const doDeleteTask = async (id: string) => {
    try {
      await tasksApi.remove(id)
      setTasks(p => p.filter(t => t.task_id !== id))
    } catch (e) {
      alert(tError(getErrorMessage(e, 'Could not delete the task / Không thể xóa công việc')))
    }
  }

  const handleDeadlineChange = async (id: string, isoDeadline: string) => {
    const before = tasks
    setTasks(p => p.map(t => t.task_id === id ? { ...t, deadline: isoDeadline } : t))
    try {
      await tasksApi.update(id, { deadline: isoDeadline })
    } catch (e) {
      setTasks(before)
      alert(tError(getErrorMessage(e, 'Could not update the deadline / Không thể cập nhật hạn chót')))
    }
  }

  // Open the avatar re-select picker for a task, prefilled with its assignees.
  const openAssignees = (task: Task) => {
    setEditingAssignees(task)
    setPickedStaff((task.assignees ?? []).map(a => a.user_id))
  }
  const saveAssignees = async () => {
    if (!editingAssignees) return
    const id = editingAssignees.task_id
    try {
      const updated = await tasksApi.setAssignees(id, pickedStaff)
      setTasks(p => p.map(t => t.task_id === id ? { ...t, assignees: updated } : t))
      setEditingAssignees(null)
    } catch (e) {
      alert(tError(getErrorMessage(e, 'Could not update assignees / Không thể cập nhật người được giao')))
    }
  }

  const pending    = tasks.filter(t => t.status === 'pending')
  const inProgress = tasks.filter(t => t.status === 'in_progress')
  const completed  = tasks.filter(t => t.status === 'completed')
  const overdue    = tasks.filter(t => t.status === 'overdue')

  const col = (title: string, titleVi: string, items: Task[], color: string) => (
    <div style={{ flex: 1, minWidth: '220px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
        <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>{t(title, titleVi)}</p>
        <span style={{
          marginLeft: 'auto', fontSize: '11px', fontWeight: 700,
          background: 'var(--bg-hover)', color: 'var(--text-muted)',
          padding: '1px 7px', borderRadius: '10px',
        }}>{items.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {items.map(t => (
          <TaskCard
            key={t.task_id}
            task={t}
            onStatusChange={handleStatusChange}
            isCreator={t.created_by === user?.user_id}
            canManage={isManager}
            onDelete={setPendingTaskDelete}
            onDeadlineChange={handleDeadlineChange}
            onEditAssignees={openAssignees}
          />
        ))}
        {items.length === 0 && (
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '12px 0' }}>{t('No tasks', 'Không có công việc')}</p>
        )}
      </div>
    </div>
  )

  return (
    <div>
      <TopBar title="Tasks" titleVi="Công việc" />
      <div style={{ padding: '28px' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '200px', maxWidth: '340px' }}>
            <select value={selectedEvent} onChange={e => setSelectedEvent(e.target.value)}>
              <option value="">{t('— Select an event —', '— Chọn sự kiện —')}</option>
              {events.map(e => (
                <option key={e.event_id} value={e.event_id}>{e.event_name}</option>
              ))}
            </select>
          </div>
          {selectedEvent && isManager && (
            <button
              onClick={() => setShowModal(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                background: 'var(--accent-blue)', color: 'white',
                border: 'none', borderRadius: '9px',
                padding: '9px 18px', fontSize: '13px', fontWeight: 600,
              }}>
              <Plus size={15} /> {t('New Task', 'Tạo công việc')}
            </button>
          )}
        </div>

        {/* Live milestone tracker for the selected event (updates as task
            statuses change). 0% with no tasks, 100% when all are completed. */}
        {selectedEvent && !loading && (
          <div style={{ maxWidth: '440px', marginBottom: '22px' }}>
            <MilestoneBar completed={completed.length} total={tasks.length} />
          </div>
        )}

        {!selectedEvent ? (
          <div style={{
            background: 'var(--bg-card)', border: '1px dashed var(--border-light)',
            borderRadius: '12px', padding: '60px', textAlign: 'center',
          }}>
            <CheckSquare size={36} color="var(--text-muted)" style={{ margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '15px', fontWeight: 600 }}>
              {t('Select an event to view tasks', 'Chọn sự kiện để xem công việc')}
            </p>
          </div>
        ) : loading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>{t('Loading tasks...', 'Đang tải công việc...')}</p>
        ) : (
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {col('Pending',     'Chờ xử lý',  pending,    'var(--accent-blue)')}
            {col('In Progress', 'Đang làm',   inProgress, 'var(--accent-teal)')}
            {col('Completed',   'Hoàn thành', completed,  'var(--accent-green)')}
            {col('Overdue',     'Quá hạn',    overdue,    'var(--accent-red)')}
          </div>
        )}
      </div>

      {showModal && (
        <Modal title={t('Create New Task', 'Tạo công việc mới')} onClose={() => { setShowModal(false); setError('') }}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {t('Task Name', 'Tên công việc')}
            </label>
            <input
              value={form.task_name}
              onChange={e => setForm(f => ({ ...f, task_name: e.target.value }))}
              placeholder={t('Enter task name...', 'Nhập tên công việc...')}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {t('Description', 'Mô tả')}
            </label>
            <textarea rows={3} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              style={{ resize: 'vertical' }} />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {t('Priority', 'Ưu tiên')}
            </label>
            <select value={form.priority_label} onChange={e => setForm(f => ({ ...f, priority_label: e.target.value }))}>
              <option value="low">{t('Low', 'Thấp')}</option>
              <option value="medium">{t('Medium', 'Trung bình')}</option>
              <option value="high">{t('High', 'Cao')}</option>
            </select>
          </div>

          {/* Assign to one or many of the manager's own staff. */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {t('Assign To', 'Giao cho')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({t('your staff', 'nhân viên của bạn')})</span>
            </label>
            <div style={{
              maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px',
              border: '1px solid var(--border)', borderRadius: '8px', padding: '8px',
            }}>
              {assignableStaff.length === 0 ? (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '6px' }}>
                  {t('You have no staff to assign', 'Bạn chưa có nhân viên để giao')}
                </span>
              ) : assignableStaff.map(m => {
                const checked = form.assigned_to.includes(m.user_id)
                return (
                  <label key={m.user_id} style={{
                    display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 9px', borderRadius: '7px',
                    cursor: 'pointer', background: checked ? 'var(--bg-hover)' : 'transparent', fontSize: '13px',
                  }}>
                    <input type="checkbox" checked={checked}
                      onChange={() => setForm(f => ({ ...f, assigned_to: toggle(f.assigned_to, m.user_id) }))}
                      style={{ width: 'auto', margin: 0 }} />
                    <span style={{ color: 'var(--text-primary)' }}>{m.name}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {selEvent && (
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px' }}>
              {t('Within event', 'Trong sự kiện')}: {evStart.replace('T', ' ')} → {evEnd.replace('T', ' ')}
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '16px' }}>
            {dateTimeRow('Start', 'Bắt đầu', 'startDate', 'startTime')}
            {dateTimeRow('Deadline', 'Hạn chót', 'deadlineDate', 'deadlineTime')}
          </div>

          {error && <p style={{ color: 'var(--accent-red)', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button onClick={() => { setShowModal(false); setError('') }}
              style={{
                background: 'var(--bg-hover)', color: 'var(--text-secondary)',
                border: '1px solid var(--border)', borderRadius: '8px',
                padding: '9px 18px', fontSize: '13px',
              }}>{t('Cancel', 'Hủy')}</button>
            <button onClick={handleCreate} disabled={saving}
              style={{
                background: 'var(--accent-blue)', color: 'white',
                border: 'none', borderRadius: '8px',
                padding: '9px 18px', fontSize: '13px', fontWeight: 600,
                opacity: saving ? 0.6 : 1,
              }}>{saving ? t('Creating...', 'Đang tạo...') : t('Create Task', 'Tạo công việc')}</button>
          </div>
        </Modal>
      )}

      {/* Re-select a task's assignees (clicked from its avatars). */}
      {editingAssignees && (
        <Modal
          title={t('Assignees', 'Người được giao') + ' — ' + editingAssignees.task_name}
          onClose={() => setEditingAssignees(null)}
        >
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
            {t('Select one or more of your staff for this task.', 'Chọn một hoặc nhiều nhân viên của bạn cho công việc này.')}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '320px', overflowY: 'auto' }}>
            {assignableStaff.length === 0 ? (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '6px' }}>
                {t('You have no staff to assign', 'Bạn chưa có nhân viên để giao')}
              </span>
            ) : assignableStaff.map(m => {
              const checked = pickedStaff.includes(m.user_id)
              return (
                <label key={m.user_id} style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: '8px',
                  cursor: 'pointer', background: checked ? 'var(--bg-hover)' : 'transparent',
                  border: '1px solid var(--border)', fontSize: '13px',
                }}>
                  <input type="checkbox" checked={checked}
                    onChange={() => setPickedStaff(prev => toggle(prev, m.user_id))}
                    style={{ width: 'auto', margin: 0 }} />
                  <Avatar src={m.avatar} size={28} radius={14} iconColor="var(--accent-blue)" bg="rgba(59,130,246,0.16)" />
                  <span style={{ color: 'var(--text-primary)' }}>{m.name}</span>
                </label>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button onClick={() => setEditingAssignees(null)} style={{
              background: 'var(--bg-hover)', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', borderRadius: '8px',
              padding: '9px 18px', fontSize: '13px',
            }}>{t('Cancel', 'Hủy')}</button>
            <button onClick={saveAssignees} style={{
              background: 'var(--accent-blue)', color: 'white',
              border: 'none', borderRadius: '8px',
              padding: '9px 18px', fontSize: '13px', fontWeight: 600,
            }}>{t('Save', 'Lưu')}</button>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!pendingReopen}
        title={t('Reopen task', 'Mở lại công việc')}
        message={t('Reopen this completed task?', 'Mở lại công việc đã hoàn thành này?')}
        confirmLabel={t('Reopen', 'Mở lại')}
        cancelLabel={t('Cancel', 'Hủy')}
        onConfirm={() => { const p = pendingReopen; setPendingReopen(null); if (p) void applyStatus(p.id, p.status) }}
        onCancel={() => setPendingReopen(null)}
      />

      <ConfirmDialog
        open={!!pendingTaskDelete}
        danger
        title={t('Delete task', 'Xóa công việc')}
        message={t('Delete this task? This cannot be undone.', 'Xóa công việc này? Hành động không thể hoàn tác.')}
        confirmLabel={t('Delete', 'Xóa')}
        cancelLabel={t('Cancel', 'Hủy')}
        onConfirm={() => { if (pendingTaskDelete) void doDeleteTask(pendingTaskDelete); setPendingTaskDelete(null) }}
        onCancel={() => setPendingTaskDelete(null)}
      />
    </div>
  )
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div style={{ padding: '28px', color: 'var(--text-muted)' }}>Loading...</div>}>
      <TasksContent />
    </Suspense>
  )
}
