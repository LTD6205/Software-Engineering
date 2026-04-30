'use client'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plus, CheckSquare } from 'lucide-react'
import axios from 'axios'
import { tasksApi, eventsApi } from '@/lib/api'
import { Task, Event } from '@/lib/types'
import TopBar from '@/components/TopBar'
import TaskCard from '@/components/TaskCard'
import Modal from '@/components/Modal'
import { useAuth } from '@/context/AuthContext'

const emptyTask = {
  task_name: '', description: '',
  priority_label: 'medium', deadline: '', start_time: '',
  assigned_to: '',
}

function TasksContent() {
  const searchParams = useSearchParams()
  const eventId      = searchParams.get('eventId') || ''
  const { user, isManager } = useAuth()

  const [events, setEvents]               = useState<Event[]>([])
  const [selectedEvent, setSelectedEvent] = useState(eventId)
  const [tasks, setTasks]                 = useState<Task[]>([])
  const [loading, setLoading]             = useState(false)
  const [showModal, setShowModal]         = useState(false)
  const [form, setForm]                   = useState({ ...emptyTask })
  const [saving, setSaving]               = useState(false)
  const [error, setError]                 = useState('')
  const [teamMembers, setTeamMembers]     = useState<{ user_id: string; name: string; role: string }[]>([])

  const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api'

  useEffect(() => {
    eventsApi.getAll().then(setEvents)
    if (isManager) {
      axios.get(`${API}/users`)
        .then(r => setTeamMembers(r.data))
        .catch(() => {})
    }
  }, [isManager])

  useEffect(() => {
    if (!selectedEvent) return
    setLoading(true)
    tasksApi.getByEvent(selectedEvent)
      .then(setTasks)
      .finally(() => setLoading(false))
  }, [selectedEvent])

  const handleCreate = async () => {
    if (!form.task_name || !selectedEvent) {
      setError('Task name and event are required.')
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
        ...(form.deadline   ? { deadline:   new Date(form.deadline).toISOString() }   : {}),
        ...(form.start_time ? { start_time: new Date(form.start_time).toISOString() } : {}),
      })

      if (form.assigned_to) {
        await tasksApi.assign(task.task_id, form.assigned_to)
      }

      setShowModal(false)
      setForm({ ...emptyTask })
      setTasks(await tasksApi.getByEvent(selectedEvent))
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to create task.')
    } finally { setSaving(false) }
  }

  const handleStatusChange = async (id: string, status: string) => {
    await tasksApi.update(id, { status, actor_user_id: user?.user_id || '' })
    setTasks(prev => prev.map(t => t.task_id === id ? { ...t, status: status as Task['status'] } : t))
  }

  const pending    = tasks.filter(t => t.status === 'pending')
  const inProgress = tasks.filter(t => t.status === 'in_progress')
  const completed  = tasks.filter(t => t.status === 'completed')
  const overdue    = tasks.filter(t => t.status === 'overdue')

  const col = (title: string, titleVi: string, items: Task[], color: string) => (
    <div style={{ flex: 1, minWidth: '220px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
        <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</p>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>/ {titleVi}</p>
        <span style={{
          marginLeft: 'auto', fontSize: '11px', fontWeight: 700,
          background: 'var(--bg-hover)', color: 'var(--text-muted)',
          padding: '1px 7px', borderRadius: '10px',
        }}>{items.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {items.map(t => (
          <TaskCard key={t.task_id} task={t} onStatusChange={handleStatusChange} />
        ))}
        {items.length === 0 && (
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '12px 0' }}>No tasks</p>
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
              <option value="">— Select an event / Chọn sự kiện —</option>
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
              <Plus size={15} /> New Task / Tạo công việc
            </button>
          )}
        </div>

        {!selectedEvent ? (
          <div style={{
            background: 'var(--bg-card)', border: '1px dashed var(--border-light)',
            borderRadius: '12px', padding: '60px', textAlign: 'center',
          }}>
            <CheckSquare size={36} color="var(--text-muted)" style={{ margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '15px', fontWeight: 600 }}>
              Select an event to view tasks
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '6px' }}>
              Chọn sự kiện để xem danh sách công việc
            </p>
          </div>
        ) : loading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading tasks...</p>
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
        <Modal title="Create New Task / Tạo công việc mới" onClose={() => { setShowModal(false); setError('') }}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Task Name / Tên công việc
            </label>
            <input
              value={form.task_name}
              onChange={e => setForm(f => ({ ...f, task_name: e.target.value }))}
              placeholder="Enter task name..."
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Description / Mô tả
            </label>
            <textarea rows={3} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              style={{ resize: 'vertical' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Priority / Ưu tiên
              </label>
              <select value={form.priority_label} onChange={e => setForm(f => ({ ...f, priority_label: e.target.value }))}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Assign To / Giao cho
              </label>
              <select value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}>
                <option value="">— Select member —</option>
                {teamMembers.map(m => (
                  <option key={m.user_id} value={m.user_id}>{m.name} ({m.role})</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Start Time / Bắt đầu
              </label>
              <input type="datetime-local" value={form.start_time}
                onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Deadline / Hạn chót
              </label>
              <input type="datetime-local" value={form.deadline}
                onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
            </div>
          </div>

          {error && <p style={{ color: 'var(--accent-red)', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button onClick={() => { setShowModal(false); setError('') }}
              style={{
                background: 'var(--bg-hover)', color: 'var(--text-secondary)',
                border: '1px solid var(--border)', borderRadius: '8px',
                padding: '9px 18px', fontSize: '13px',
              }}>Cancel</button>
            <button onClick={handleCreate} disabled={saving}
              style={{
                background: 'var(--accent-blue)', color: 'white',
                border: 'none', borderRadius: '8px',
                padding: '9px 18px', fontSize: '13px', fontWeight: 600,
                opacity: saving ? 0.6 : 1,
              }}>{saving ? 'Creating...' : 'Create Task'}</button>
          </div>
        </Modal>
      )}
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