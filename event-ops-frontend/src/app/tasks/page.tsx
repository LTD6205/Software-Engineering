'use client'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Plus, CheckSquare, RotateCcw } from 'lucide-react'
import { tasksApi, eventsApi, usersApi, getErrorMessage } from '@/lib/api'
import { Task, Event } from '@/lib/types'
import { toLocalInputValue } from '@/lib/time'
import TimePicker from '@/components/TimePicker'
import TopBar from '@/components/TopBar'
import TaskTimeline from '@/components/TaskTimeline'
import Dropdown from '@/components/Dropdown'
import Modal from '@/components/Modal'
import Avatar from '@/components/Avatar'
import MilestoneBar from '@/components/MilestoneBar'
import EventPicker from '@/components/EventPicker'
import ConfirmDialog from '@/components/ConfirmDialog'
import Toast, { type ToastData } from '@/components/Toast'
import { useAuth } from '@/context/AuthContext'
import { useLang } from '@/context/LanguageContext'
import { useLiveData, type DataChange } from '@/lib/useLiveData'

const emptyTask = {
  task_name: '', description: '',
  startDate: '', startTime: '', deadlineDate: '', deadlineTime: '',
  assigned_to: [] as string[],
}

// Current epoch ms. Module-level so the "is this in the past?" guards can read
// real time without tripping the React Compiler's purity check (it only flags
// known-impure globals like Date.now() called inside a component).
const nowMs = () => Date.now()

function TasksContent() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()
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
  // Filters — status + priority.
  const [taskStatus, setTaskStatus]     = useState<'all' | 'pending' | 'in_progress' | 'completed' | 'overdue'>('all')
  const [taskPriority, setTaskPriority] = useState<'all' | 'low' | 'medium' | 'high'>('all')
  // In-app toast (replaces native showToast()) for errors and notices.
  const [toast, setToast] = useState<ToastData | null>(null)
  const dismissToast = useCallback(() => setToast(null), [])
  const showToast = useCallback(
    (message: string, kind: 'error' | 'info' = 'error') => setToast({ message, kind }),
    [],
  )

  // Staff this manager may assign: their own team (admins may assign any staff).
  const assignableStaff = teamMembers.filter(
    m => m.role === 'staff' && (isAdmin || m.manager_id === user?.user_id),
  )
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter(x => x !== id) : [...list, id]

  // Select an event AND mirror it into the URL (?eventId=) so the AI drawer
  // (which reads the search param) sees the current event, and deep-links /
  // refreshes restore the same selection. replace() (not push) keeps this out of
  // history; { scroll: false } avoids jumping to the top on each pick. We only
  // WRITE the URL here on selection changes — the line-43 initializer seeds the
  // initial state from the URL, so there's no effect reading it back (no loop).
  const chooseEvent = useCallback((id: string) => {
    setSelectedEvent(id)
    router.replace(`${pathname}?eventId=${id}`, { scroll: false })
  }, [router, pathname])

  const refreshEvents = useCallback(() => {
    eventsApi.getAll().then(setEvents).catch(() => {})
  }, [])

  useEffect(() => {
    refreshEvents()
    if (isManager) {
      usersApi.getAll()
        .then(setTeamMembers)
        .catch(() => {})
    }
  }, [isManager, refreshEvents])

  // Land directly on an event instead of forcing a manual pick: if none is
  // chosen yet, default to the first one the viewer can see.
  useEffect(() => {
    if (!selectedEvent && events.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      chooseEvent(events[0].event_id)
    }
  }, [events, selectedEvent, chooseEvent])

  // The event's 3 most-recent task changes, powering the Undo button (managers/
  // admins only). Refreshed on event switch and after any live change.
  const [changes, setChanges] = useState<{ id: string; change_type: string; label: string }[]>([])
  const loadChanges = useCallback(() => {
    if (selectedEvent && isManager) {
      tasksApi.changes(selectedEvent).then(setChanges).catch(() => setChanges([]))
    } else {
      setChanges([])
    }
  }, [selectedEvent, isManager])

  // Live updates: when anyone changes a task/event, refresh the board + milestone
  // without a manual reload (e.g. a staff completing the last task).
  const onLiveChange = useCallback((c: DataChange) => {
    refreshEvents()
    if (selectedEvent && (!c.event_id || c.event_id === selectedEvent)) {
      tasksApi.getByEvent(selectedEvent).then(setTasks).catch(() => {})
      loadChanges()
    }
  }, [selectedEvent, refreshEvents, loadChanges])
  useLiveData(onLiveChange)

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
    loadChanges()
  }, [selectedEvent, loadChanges])

  // The task's dates must stay within the parent event's time range.
  const selEvent = events.find(e => e.event_id === selectedEvent)
  const evStart = toLocalInputValue(selEvent?.start_time) // "YYYY-MM-DDTHH:mm"
  const evEnd   = toLocalInputValue(selEvent?.end_time)

  const handleCreate = async () => {
    if (!selectedEvent) {
      setError(t('Please select an event', 'Vui lòng chọn sự kiện'))
      return
    }
    // Description is optional; everything else (incl. at least one assignee) is required.
    if (!form.task_name || form.assigned_to.length === 0 ||
        !form.startDate || !form.startTime || !form.deadlineDate || !form.deadlineTime) {
      setError(t('Please fill in every field except description', 'Vui lòng điền tất cả các trường trừ mô tả'))
      return
    }
    const start = `${form.startDate}T${form.startTime}`
    const deadline = `${form.deadlineDate}T${form.deadlineTime}`

    if (start && deadline && deadline <= start) {
      setError(t('Deadline must be after the start time', 'Hạn chót phải sau thời gian bắt đầu'))
      return
    }
    // Can't schedule a new task in the past (before the live "now" line).
    if (start && new Date(start).getTime() < nowMs()) {
      setError(t('Start time cannot be in the past', 'Thời gian bắt đầu không thể ở quá khứ'))
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
      refreshEvents() // task count changed -> refresh the milestone
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
        <TimePicker value={form[timeKey]} onChange={v => setForm(f => ({ ...f, [timeKey]: v }))} />
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
      // Refetch tasks (not just events): a status change re-buckets auto
      // priorities server-side, and reopening an overdue task slides its dates
      // to now — neither is reflected by the optimistic status-only update above.
      if (selectedEvent) setTasks(await tasksApi.getByEvent(selectedEvent))
      refreshEvents() // completion count changed -> refresh the milestone
    } catch (e) {
      setTasks(p => p.map(t => t.task_id === id ? { ...t, status: prev } : t))
      showToast(tError(getErrorMessage(e, 'Could not update status / Không thể cập nhật trạng thái')))
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
      refreshEvents() // task count changed -> refresh the milestone
    } catch (e) {
      showToast(tError(getErrorMessage(e, 'Could not delete the task / Không thể xóa công việc')))
    }
  }

  const handleDeadlineChange = async (id: string, isoDeadline: string) => {
    // A deadline can't be moved into the past (before the live "now" line).
    if (new Date(isoDeadline).getTime() < nowMs()) {
      showToast(t('Deadline cannot be moved to the past', 'Không thể dời hạn chót về quá khứ'))
      return
    }
    const before = tasks
    setTasks(p => p.map(t => t.task_id === id ? { ...t, deadline: isoDeadline } : t))
    try {
      await tasksApi.update(id, { deadline: isoDeadline })
    } catch (e) {
      setTasks(before)
      showToast(tError(getErrorMessage(e, 'Could not update the deadline / Không thể cập nhật hạn chót')))
    }
  }

  const handleRename = async (id: string, name: string) => {
    const clean = name.trim()
    const task = tasks.find(t => t.task_id === id)
    if (!task || !clean || clean === task.task_name) return
    const before = tasks
    setTasks(p => p.map(t => t.task_id === id ? { ...t, task_name: clean } : t))
    try {
      await tasksApi.update(id, { task_name: clean })
    } catch (e) {
      setTasks(before)
      showToast(tError(getErrorMessage(e, 'Could not rename the task / Không thể đổi tên công việc')))
    }
  }

  const handleStartChange = async (id: string, isoStart: string) => {
    const task = tasks.find(t => t.task_id === id)
    if (!task) return
    // A start time can't be in the past (the live "now" line) and must stay
    // before the deadline (the server enforces both; guard here for a clear toast).
    if (new Date(isoStart).getTime() < nowMs()) {
      showToast(t('Start time cannot be moved to the past', 'Không thể dời thời gian bắt đầu về quá khứ'))
      return
    }
    if (task.deadline && new Date(isoStart).getTime() >= new Date(task.deadline).getTime()) {
      showToast(t('Start time must be before the deadline', 'Thời gian bắt đầu phải trước hạn chót'))
      return
    }
    const before = tasks
    setTasks(p => p.map(t => t.task_id === id ? { ...t, start_time: isoStart } : t))
    try {
      await tasksApi.update(id, { start_time: isoStart })
    } catch (e) {
      setTasks(before)
      showToast(tError(getErrorMessage(e, 'Could not update the start time / Không thể cập nhật thời gian bắt đầu')))
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
      showToast(tError(getErrorMessage(e, 'Could not update assignees / Không thể cập nhật người được giao')))
    }
  }

  // Filter predicate (status + priority).
  const matches = (tk: Task) => {
    if (taskStatus !== 'all' && tk.status !== taskStatus) return false
    if (taskPriority !== 'all' && tk.priority_label !== taskPriority) return false
    return true
  }
  const resetTaskFilters = () => { setTaskStatus('all'); setTaskPriority('all') }

  // Merge / group actions — refetch after each so the timeline reflects the
  // new spans and grouping immediately (the live socket also broadcasts).
  const reloadTasks = async () => {
    if (selectedEvent) setTasks(await tasksApi.getByEvent(selectedEvent))
    refreshEvents()
  }
  // Undo the event's most recent task change (edit or deletion). Same backend
  // path the AI's "undo" uses. Click again to step back through the kept history.
  const handleUndo = async () => {
    if (!selectedEvent || changes.length === 0) return
    try {
      await tasksApi.undoLast(selectedEvent)
      await reloadTasks()
      loadChanges()
    } catch (e) {
      showToast(tError(getErrorMessage(e, 'Could not undo / Không thể hoàn tác')))
    }
  }
  // Batch actions on Ctrl-selected tasks (each is one undoable operation).
  const handleBatchDelete = async (ids: string[]) => {
    if (!ids.length) return
    try { await tasksApi.batchDelete(ids); await reloadTasks(); loadChanges() }
    catch (e) { showToast(tError(getErrorMessage(e, 'Could not delete the selected tasks / Không thể xóa các công việc đã chọn'))) }
  }
  const handleBatchUngroup = async (ids: string[]) => {
    if (!ids.length) return
    try { await tasksApi.batchUngroup(ids); await reloadTasks(); loadChanges() }
    catch (e) { showToast(tError(getErrorMessage(e, 'Could not ungroup the selected tasks / Không thể tách nhóm các công việc đã chọn'))) }
  }
  const handleMerge = async (sourceId: string, targetId: string) => {
    try { await tasksApi.merge(sourceId, targetId); await reloadTasks() }
    catch (e) { showToast(tError(getErrorMessage(e, 'Could not merge the tasks / Không thể gộp công việc'))) }
  }
  const handleAddToGroup = async (groupId: string, taskId: string) => {
    try { await tasksApi.addToGroup(groupId, taskId); await reloadTasks() }
    catch (e) { showToast(tError(getErrorMessage(e, 'Could not add to the group / Không thể thêm vào nhóm'))) }
  }
  const handleUngroup = async (taskId: string) => {
    try { await tasksApi.ungroup(taskId); await reloadTasks() }
    catch (e) { showToast(tError(getErrorMessage(e, 'Could not ungroup / Không thể tách nhóm'))) }
  }
  const handleRenameGroup = async (groupId: string, title: string) => {
    try { await tasksApi.renameGroup(groupId, title); await reloadTasks() }
    catch (e) { showToast(tError(getErrorMessage(e, 'Could not rename the group / Không thể đổi tên nhóm'))) }
  }
  // Manual priority override from a task's Edit panel (pins it to user-set).
  const handleEditPriority = async (taskId: string, label: string) => {
    const score = label === 'high' ? 90 : label === 'medium' ? 50 : 10
    setTasks(p => p.map(t => t.task_id === taskId ? { ...t, priority_label: label as Task['priority_label'], priority_score: score } : t))
    try { await tasksApi.update(taskId, { priority_label: label, priority_score: score }) }
    catch (e) { await reloadTasks(); showToast(tError(getErrorMessage(e, 'Could not update priority / Không thể cập nhật ưu tiên'))) }
  }
  // Open the create modal. From a timeline right-click we get the clicked time:
  // pre-fill Start there and End one hour later.
  const openNewTask = (startISO?: string) => {
    if (startISO) {
      const s = new Date(startISO)
      const e = new Date(s.getTime() + 3 * 60 * 60 * 1000)
      const p = (n: number) => String(n).padStart(2, '0')
      const dstr = (x: Date) => `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`
      const tstr = (x: Date) => `${p(x.getHours())}:${p(x.getMinutes())}`
      setForm({ ...emptyTask, startDate: dstr(s), startTime: tstr(s), deadlineDate: dstr(e), deadlineTime: tstr(e) })
    } else {
      setForm({ ...emptyTask })
    }
    setError('')
    setShowModal(true)
  }
  // Drag a block along the timeline to reschedule it (keeps its length). The
  // optimistic move gives instant feedback; reloadTasks() then pulls the
  // server-recomputed auto priorities (a reschedule re-buckets the task — and,
  // for a grouped task, re-ranks it within its group — so its High/Med/Low can
  // change), which the optimistic update alone wouldn't reflect.
  const handleReschedule = async (taskId: string, startISO: string, deadlineISO: string) => {
    setTasks(p => p.map(t => t.task_id === taskId ? { ...t, start_time: startISO, deadline: deadlineISO } : t))
    try { await tasksApi.update(taskId, { start_time: startISO, deadline: deadlineISO }); await reloadTasks() }
    catch (e) { await reloadTasks(); showToast(tError(getErrorMessage(e, 'Could not move the task / Không thể di chuyển công việc'))) }
  }

  return (
    <div>
      <TopBar title="Tasks" titleVi="Công việc" />
      <div style={{ padding: '28px' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
          <EventPicker events={events} value={selectedEvent} onChange={chooseEvent} />
          {selectedEvent && isManager && (
            <button
              onClick={() => openNewTask()}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                background: 'var(--accent-blue)', color: 'white',
                border: 'none', borderRadius: '9px',
                padding: '10px 18px', fontSize: '13px', fontWeight: 600,
              }}>
              <Plus size={15} /> {t('New Task', 'Tạo công việc')}
            </button>
          )}
          {selectedEvent && isManager && (
            <button
              onClick={handleUndo}
              disabled={changes.length === 0}
              title={changes[0]
                ? `${t('Undo', 'Hoàn tác')}: ${changes[0].label}`
                : t('Nothing to undo', 'Không có gì để hoàn tác')}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                background: 'var(--bg-hover)', color: 'var(--text-secondary)',
                border: '1px solid var(--border)', borderRadius: '9px',
                padding: '10px 16px', fontSize: '13px', fontWeight: 600,
                cursor: changes.length === 0 ? 'default' : 'pointer',
                opacity: changes.length === 0 ? 0.5 : 1,
              }}>
              <RotateCcw size={15} /> {t('Undo', 'Hoàn tác')}{changes.length ? ` (${changes.length})` : ''}
            </button>
          )}
        </div>

        {/* Milestone tracker for the selected event — uses the event's
            authoritative task counts so it's the same for everyone (staff only
            see their own tasks, but the milestone reflects the whole event). */}
        {selEvent && !loading && (
          <div style={{ maxWidth: '440px', marginBottom: '22px' }}>
            <MilestoneBar completed={selEvent.completed_count ?? 0} total={selEvent.task_count ?? 0} />
          </div>
        )}

        {/* Filter bar: status + priority. */}
        {selectedEvent && !loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
            <Dropdown size="sm" value={taskStatus} onChange={v => setTaskStatus(v as typeof taskStatus)}
              ariaLabel={t('Filter by status', 'Lọc theo trạng thái')}
              options={[
                { value: 'all', label: t('All statuses', 'Mọi trạng thái') },
                { value: 'in_progress', label: t('In Progress', 'Đang làm'), color: 'var(--accent-blue)' },
                { value: 'completed', label: t('Completed', 'Hoàn thành'), color: 'var(--accent-green)' },
                { value: 'overdue', label: t('Overdue', 'Quá hạn'), color: 'var(--accent-red)' },
              ]} />
            <Dropdown size="sm" value={taskPriority} onChange={v => setTaskPriority(v as typeof taskPriority)}
              ariaLabel={t('Filter by priority', 'Lọc theo ưu tiên')}
              options={[
                { value: 'all', label: t('All priorities', 'Mọi mức ưu tiên') },
                { value: 'high', label: t('High', 'Cao'), color: 'var(--accent-red)' },
                { value: 'medium', label: t('Medium', 'Trung bình'), color: 'var(--accent-amber)' },
                { value: 'low', label: t('Low', 'Thấp'), color: 'var(--accent-green)' },
              ]} />
          </div>
        )}

        {!selectedEvent ? (
          <div style={{
            background: 'var(--bg-card)', border: '1px dashed var(--border-light)',
            borderRadius: '12px', padding: '60px', textAlign: 'center',
          }}>
            <CheckSquare size={36} color="var(--text-muted)" style={{ margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '15px', fontWeight: 600 }}>
              {events.length === 0
                ? t('You are not part of any event yet', 'Bạn chưa thuộc sự kiện nào')
                : t('Select an event to view tasks', 'Chọn sự kiện để xem công việc')}
            </p>
          </div>
        ) : loading || !selEvent ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>{t('Loading tasks...', 'Đang tải công việc...')}</p>
        ) : (
          <TaskTimeline
            event={selEvent}
            tasks={tasks}
            matches={matches}
            canManage={isManager}
            onStatusChange={handleStatusChange}
            onRename={handleRename}
            onEditPriority={handleEditPriority}
            onStartChange={handleStartChange}
            onDeadlineChange={handleDeadlineChange}
            onEditAssignees={openAssignees}
            onDelete={setPendingTaskDelete}
            onMerge={handleMerge}
            onAddToGroup={handleAddToGroup}
            onUngroup={handleUngroup}
            onRenameGroup={handleRenameGroup}
            onResetFilters={resetTaskFilters}
            onNewTask={openNewTask}
            onReschedule={handleReschedule}
            onBatchDelete={handleBatchDelete}
            onBatchUngroup={handleBatchUngroup}
            onNotice={msg => showToast(msg, 'info')}
          />
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
              {t('Description', 'Mô tả')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({t('optional', 'không bắt buộc')})</span>
            </label>
            <textarea rows={3} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              style={{ resize: 'vertical' }} />
          </div>

          {/* Priority isn't set here — it's auto-derived from the task's place
              in the event timeline, and can be changed later in a task's Edit. */}

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

      <Toast data={toast} onClose={dismissToast} />
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
