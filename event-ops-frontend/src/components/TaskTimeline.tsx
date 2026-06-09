'use client'
import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { Clock, Trash2, Users as UsersIcon, Unlink, Pencil, Check, X, Plus, Minus, Maximize2 } from 'lucide-react'
import { Task, Event } from '@/lib/types'
import { snapMs, formatDate } from '@/lib/time'
import { HOUR, DAY, ms, packLanes, computeTicks } from '@/lib/timeline'
import { useLang } from '@/context/LanguageContext'
import Modal from './Modal'
import Dropdown from './Dropdown'
import TimePicker from './TimePicker'
import Avatar from './Avatar'
import IdChip from './IdChip'

// Status -> colour. Blocks are tinted by their current state.
const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--accent-amber)',
  in_progress: 'var(--accent-blue)',
  completed: 'var(--accent-green)',
  overdue: 'var(--accent-red)',
}
const PRIORITY_COLOR: Record<string, string> = {
  high: 'var(--accent-red)',
  medium: 'var(--accent-amber)',
  low: 'var(--accent-green)',
}

const ROW_H = 74       // height of one lane (a block); fits name + stacked start/end
const LANE_GAP = 6
const GROUP_TITLE_H = 22
const GROUP_GAP = 12
const MIN_BLOCK_PX = 14  // thin bar floor so blocks stay proportional and stretch on zoom
const LABEL_PX = 150     // horizontal room reserved for a block's label (it spills right of a thin bar)
const MAX_PXPERDAY = 3000 // deepest zoom = hour labels with 15-min gridlines
const AXIS_H = 26

interface Props {
  event: Event
  tasks: Task[]
  matches: (t: Task) => boolean
  canManage: boolean
  onStatusChange: (id: string, status: string) => void
  onRename: (id: string, name: string) => void
  onEditPriority: (id: string, label: string) => void
  onStartChange: (id: string, iso: string) => void
  onDeadlineChange: (id: string, iso: string) => void
  onEditAssignees: (task: Task) => void
  onDelete: (id: string) => void
  onMerge: (sourceId: string, targetId: string) => void
  onAddToGroup: (groupId: string, taskId: string) => void
  onUngroup: (taskId: string) => void
  onRenameGroup: (groupId: string, title: string) => void
  onResetFilters: () => void
  onNewTask: (startISO?: string) => void
  onReschedule: (taskId: string, startISO: string, deadlineISO: string) => void
  onBatchDelete: (ids: string[]) => void
  onBatchUngroup: (ids: string[]) => void
  onNotice?: (message: string) => void
}


export default function TaskTimeline(props: Props) {
  const { event, tasks, matches, canManage } = props
  const { t, lang } = useLang()

  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const dragInfo = useRef<{ taskId: string; offsetX: number; start: number; end: number } | null>(null)
  const [viewportW, setViewportW] = useState(0)
  const [pxPerDay, setPxPerDay] = useState(0)
  const [panning, setPanning] = useState(false)
  const pendingFocus = useRef<{ t: number; vx: number } | null>(null)

  const [editTask, setEditTask] = useState<Task | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; task: Task | null; time?: number } | null>(null)
  // Ctrl/Cmd-click multi-select: a set of task ids the manager can act on in
  // batch (right-click → Delete / Ungroup selected). A plain click clears it.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const onBlockClick = (taskId: string, e: React.MouseEvent) => {
    if ((e.ctrlKey || e.metaKey) && canManage) {
      setSelected(prev => {
        const n = new Set(prev)
        if (n.has(taskId)) n.delete(taskId); else n.add(taskId)
        return n
      })
      return
    }
    // A plain click with an active multi-selection just clears it (no edit
    // panel) — a second click then opens the task as normal.
    if (selected.size > 0) { setSelected(new Set()); return }
    const tk = tasks.find(x2 => x2.task_id === taskId)
    if (tk) setEditTask(tk)
  }
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  // Live "now" marker. Refreshed periodically so the blue current-time line
  // tracks real time without a reload; the same value floors scheduling so a
  // task can't be dragged/created into the past.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  const evStart = ms(event.start_time)
  const evEnd = ms(event.end_time)
  const totalDays = Math.max((evEnd - evStart) / DAY, 1)
  const fit = viewportW > 0 ? viewportW / totalDays : 0

  // Measure the viewport and pick an initial "fit whole event" zoom.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setViewportW(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
    // Re-attach when the canvas (re)mounts, e.g. when the first task appears.
  }, [tasks.length])
  useEffect(() => {
    if (fit > 0 && pxPerDay === 0) setPxPerDay(fit)
  }, [fit, pxPerDay])

  // After a zoom, keep the focused time under the same screen point.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !pendingFocus.current || pxPerDay === 0) return
    const { t: ft, vx } = pendingFocus.current
    el.scrollLeft = ((ft - evStart) / DAY) * pxPerDay - vx
    pendingFocus.current = null
  }, [pxPerDay, evStart])

  const x = (time: number) => ((time - evStart) / DAY) * pxPerDay
  const minPx = Math.max(fit, 0.5)
  const clampZoom = (v: number) => Math.min(MAX_PXPERDAY, Math.max(minPx, v))

  const zoomAt = (clientX: number, factor: number) => {
    const el = scrollRef.current
    if (!el || pxPerDay === 0) return
    const rect = el.getBoundingClientRect()
    const vx = clientX - rect.left
    const time = evStart + ((el.scrollLeft + vx) / pxPerDay) * DAY
    pendingFocus.current = { t: time, vx }
    setPxPerDay(p => clampZoom(p * factor))
  }
  const zoomButton = (factor: number) => {
    const el = scrollRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    zoomAt(rect.left + rect.width / 2, factor)
  }
  const fitAll = () => { pendingFocus.current = null; setPxPerDay(fit); const el = scrollRef.current; if (el) el.scrollLeft = 0 }

  // Wheel: plain = horizontal pan, Ctrl/Cmd = zoom to cursor. Attached natively
  // so we can preventDefault (React's onWheel is passive).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        zoomAt(e.clientX, e.deltaY < 0 ? 1.2 : 1 / 1.2)
      } else {
        e.preventDefault()
        el.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  // Hold-left-drag on the background pans (mouse left -> content right).
  const startPan = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-block]')) return // let blocks drag-to-merge
    const el = scrollRef.current
    if (!el) return
    const downX = e.clientX, downY = e.clientY
    let lastX = e.clientX, lastY = e.clientY
    setPanning(true)
    const move = (ev: MouseEvent) => {
      // Grab-to-pan: the content follows the cursor (drag left → content left).
      el.scrollLeft -= ev.clientX - lastX
      el.scrollTop -= ev.clientY - lastY
      lastX = ev.clientX; lastY = ev.clientY
    }
    const up = (ev: MouseEvent) => {
      setPanning(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      // A plain click on empty background (not a drag-pan) clears an active
      // multi-selection — the canvas equivalent of clicking a block to deselect.
      if (Math.abs(ev.clientX - downX) < 6 && Math.abs(ev.clientY - downY) < 6) {
        setSelected(prev => (prev.size > 0 ? new Set() : prev))
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // ── Build the layout (groups first, then ungrouped; lane-packed) ──
  const groups = new Map<string, Task[]>()
  const singles: Task[] = []
  for (const tk of tasks) {
    if (tk.group_id) { const a = groups.get(tk.group_id) ?? []; a.push(tk); groups.set(tk.group_id, a) }
    else singles.push(tk)
  }
  const spanOf = (tk: Task): [number, number] => {
    const s = ms(tk.start_time), d = ms(tk.deadline)
    return [!isNaN(s) ? s : d, !isNaN(d) ? d : s]
  }

  type BlockM = { task: Task; left: number; width: number; top: number; start: number; end: number }
  type BandM = { gid: string; title: string; left: number; width: number; top: number; height: number }
  const blocks: BlockM[] = []
  const bands: BandM[] = []
  const unscheduled: Task[] = []
  let cursorTop = AXIS_H + 8 // leave room for the sticky date axis at the top

  const mkBlock = (tk: Task, top: number) => {
    const [s, e] = spanOf(tk)
    if (isNaN(s) || isNaN(e)) { unscheduled.push(tk); return }
    const left = x(s)
    const width = Math.max(MIN_BLOCK_PX, ((e - s) / DAY) * pxPerDay)
    blocks.push({ task: tk, left, width, top, start: s, end: e })
  }

  if (pxPerDay > 0) {
    // Lanes are packed by VISUAL extent (bar + its label), not just time, so a
    // short block's label (which spills to the right) never overlaps the next
    // block — close tasks drop onto separate lanes instead.
    const labelMs = (LABEL_PX / pxPerDay) * DAY
    const gapMs = (8 / pxPerDay) * DAY
    const visEnd = (s: number, e: number) => Math.max(e, s + labelMs) + gapMs

    // Groups (any member matches -> show whole group), sorted by earliest start.
    const groupList = [...groups.entries()]
      .filter(([, members]) => members.some(matches))
      .map(([gid, members]) => {
        const dated = members.filter(m => { const [s, e] = spanOf(m); return !isNaN(s) && !isNaN(e) })
        const minStart = Math.min(...dated.map(m => spanOf(m)[0]))
        return { gid, members, dated, minStart: isFinite(minStart) ? minStart : evStart }
      })
      .sort((a, b) => a.minStart - b.minStart)

    for (const g of groupList) {
      const title = g.members.find(m => m.group_title)?.group_title || ''
      // Only show members that pass the filter. The group band is drawn only
      // when the WHOLE group is shown; when a filter (e.g. priority) hides some
      // members, just the matching blocks appear — not the whole group block.
      const shownMembers = g.members.filter(matches)
      const fullyShown = shownMembers.length === g.members.length
      unscheduled.push(...shownMembers.filter(m => { const [s, e] = spanOf(m); return isNaN(s) || isNaN(e) }))
      const dated = shownMembers.filter(m => { const [s, e] = spanOf(m); return !isNaN(s) && !isNaN(e) })
      if (dated.length === 0) continue
      const items = dated.map(m => { const [s, e] = spanOf(m); return { start: s, end: visEnd(s, e), realEnd: e, task: m } })
      const { placed, lanes } = packLanes(items)
      const titleH = fullyShown ? GROUP_TITLE_H : 0
      const innerTop = cursorTop + titleH
      let minL = Infinity, maxR = -Infinity
      for (const it of items) {
        const lane = placed.get(it) ?? 0
        const top = innerTop + lane * (ROW_H + LANE_GAP)
        mkBlock(it.task, top)
        minL = Math.min(minL, x(it.start))
        maxR = Math.max(maxR, x(it.start) + Math.max(LABEL_PX, ((it.realEnd - it.start) / DAY) * pxPerDay))
      }
      const height = titleH + lanes * (ROW_H + LANE_GAP) - LANE_GAP + 8
      if (fullyShown && isFinite(minL)) bands.push({ gid: g.gid, title, left: minL - 6, width: (maxR - minL) + 12, top: cursorTop, height })
      cursorTop += height + GROUP_GAP
    }

    // Ungrouped tasks, packed into their own lane area.
    const visSingles = singles.filter(matches)
    const datedSingles = visSingles.filter(m => { const [s, e] = spanOf(m); return !isNaN(s) && !isNaN(e) })
    unscheduled.push(...visSingles.filter(m => { const [s, e] = spanOf(m); return isNaN(s) || isNaN(e) }))
    const sItems = datedSingles.map(m => { const [s, e] = spanOf(m); return { start: s, end: visEnd(s, e), task: m } })
    const { placed, lanes } = packLanes(sItems)
    for (const it of sItems) {
      const lane = placed.get(it) ?? 0
      mkBlock(it.task, cursorTop + lane * (ROW_H + LANE_GAP))
    }
    if (sItems.length > 0) cursorTop += lanes * (ROW_H + LANE_GAP)
  }

  const contentWidth = Math.max(viewportW, totalDays * pxPerDay)
  // Always leave one empty lane below the last stack so there's room to drop /
  // add another block.
  const contentHeight = Math.max(cursorTop + ROW_H + LANE_GAP + 12, 220)
  // The panel grows with the stacks (so it's as tall as it needs to be) up to a
  // cap, beyond which it scrolls vertically.
  const panelH = Math.min(contentHeight, 680)
  // Based on the data (not the computed blocks), so the canvas — and its
  // measured ref — still mounts on the first render before pxPerDay is known.
  const hasVisible = singles.some(matches) || [...groups.values()].some(arr => arr.some(matches))
  const nothing = !hasVisible

  // Date-axis ticks for the current zoom (pure geometry in lib/timeline).
  const loc = lang === 'vi' ? 'vi-VN' : 'en-US'
  const { majorStep, majors, minors } = computeTicks({ pxPerDay, evStart, evEnd })
  const fmtTick = (time: number) => {
    const d = new Date(time)
    if (majorStep >= DAY) return d.toLocaleDateString(loc, majorStep >= 30 * DAY ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' })
    if (d.getHours() === 0 && d.getMinutes() === 0) return d.toLocaleDateString(loc, { day: 'numeric', month: 'short' })
    return d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', hour12: lang !== 'vi' })
  }
  const fmtFull = (iso?: string | null) => formatDate(iso, lang)
  // ── Drag-and-drop, handled entirely at the canvas level by geometry so it's
  // reliable no matter which element the browser reports under the cursor (this
  // is why dragging one block onto ANOTHER always merges, even when they
  // overlap or were both just created). ──
  // Find what the drop point (content coords) lands on, ignoring the dragged task.
  const hitAt = (cx: number, cy: number, exceptId: string) => {
    // Hit area spans the bar plus its label (a thin bar's label spills right).
    const b = blocks.find(bl => bl.task.task_id !== exceptId && cx >= bl.left && cx <= bl.left + Math.max(bl.width, LABEL_PX) && cy >= bl.top && cy <= bl.top + ROW_H)
    if (b) return { block: b }
    const bd = bands.find(d => cx >= d.left && cx <= d.left + d.width && cy >= d.top && cy <= d.top + d.height)
    if (bd) return { band: bd }
    return {}
  }
  const onCanvasDragOver = (e: React.DragEvent) => {
    if (!canManage || !dragId) return
    e.preventDefault()
    const el = contentRef.current; if (!el) return
    const rect = el.getBoundingClientRect()
    const hit = hitAt(e.clientX - rect.left, e.clientY - rect.top, dragId)
    setDropKey(hit.block ? hit.block.task.task_id : hit.band ? hit.band.gid : null)
  }
  const onCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const src = dragId; const info = dragInfo.current
    setDragId(null); setDropKey(null); dragInfo.current = null
    const el = contentRef.current
    if (!src || !el) return
    const rect = el.getBoundingClientRect()
    const hit = hitAt(e.clientX - rect.left, e.clientY - rect.top, src)
    if (hit.block) {
      // Dropped over another block → merge (or join its group).
      if (hit.block.task.group_id) props.onAddToGroup(hit.block.task.group_id, src)
      else props.onMerge(src, hit.block.task.task_id)
      return
    }
    const srcTask = tasks.find(x2 => x2.task_id === src)
    if (hit.band && srcTask?.group_id !== hit.band.gid) {
      // Dropped over a different group's band → add to that group.
      props.onAddToGroup(hit.band.gid, src)
      return
    }
    // Empty space (or own group band) → move/reschedule, keeping its length.
    if (info && !isNaN(info.start) && !isNaN(info.end) && pxPerDay > 0) {
      const dropX = (e.clientX - rect.left) - info.offsetX
      const duration = info.end - info.start
      const intended = snapMs(evStart + (dropX / pxPerDay) * DAY)
      // Floor at "now" (and the event start) so a task can't be moved into the
      // past; ceil so it still ends within the event window.
      const floor = Math.max(evStart, now)
      const newStart = Math.max(floor, Math.min(intended, evEnd - duration))
      // Tell the user why it snapped if they aimed before the "now" line.
      if (intended < floor) {
        props.onNotice?.(t("Tasks can't be moved before the current time", 'Không thể chuyển công việc về trước thời điểm hiện tại'))
      }
      props.onReschedule(info.taskId, new Date(newStart).toISOString(), new Date(newStart + duration).toISOString())
    }
  }

  // Every block (however created) shows date + time and renders proportionally
  // to its duration, so it stretches as you zoom in. Content reveals itself as
  // the block gets wider: name → stacked date/time → priority badge → avatars.
  const stamp = (tm: number) => {
    const d = new Date(tm)
    const date = d.toLocaleDateString(loc, { day: 'numeric', month: 'short' })
    const time = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', hour12: lang !== 'vi' })
    return `${date}, ${time}`
  }
  const block = (b: BlockM) => {
    const tk = b.task
    const completed = tk.status === 'completed'
    const overdue = tk.status === 'overdue'
    const pColor = PRIORITY_COLOR[tk.priority_label] || 'var(--text-muted)'
    const pLabel = tk.priority_label === 'high' ? t('High', 'Cao') : tk.priority_label === 'low' ? t('Low', 'Thấp') : t('Med', 'TB')
    // Show assignee avatars whenever the task has any, regardless of the bar's
    // width/zoom. The label spills to the right of a thin bar and the name (not
    // the avatars) is the part that truncates, so short tasks keep their icons.
    const showAvatars = (tk.assignees ?? []).length > 0
    return (
      <div
        key={tk.task_id}
        data-block data-task-id={tk.task_id}
        draggable={canManage}
        onDragStart={e => { if (canManage) { setDragId(tk.task_id); dragInfo.current = { taskId: tk.task_id, offsetX: e.nativeEvent.offsetX, start: b.start, end: b.end }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tk.task_id) } }}
        onDragEnd={() => { setDragId(null); setDropKey(null); dragInfo.current = null }}
        onClick={e => onBlockClick(tk.task_id, e)}
        title={`${tk.task_name}\n${pLabel} · ${stamp(b.start)} → ${stamp(b.end)}`}
        style={{
          // The coloured bar is proportional to the duration (so it stretches on
          // zoom); the label below spills to the right when the bar is thin so
          // the text is always readable. overflow:visible lets the label spill.
          position: 'absolute', left: b.left, top: b.top, width: b.width, height: ROW_H,
          borderRadius: '8px', cursor: canManage ? 'grab' : 'pointer',
          background: completed ? 'var(--bg-hover)' : `${pColor}26`,
          border: `1.5px solid ${dropKey === tk.task_id ? 'var(--text-primary)' : completed ? 'var(--border)' : pColor}`,
          opacity: completed ? 0.55 : 1,
          boxShadow: [
            selected.has(tk.task_id) ? '0 0 0 2px var(--accent-purple)' : '',
            overdue ? '0 0 12px rgba(239,68,68,0.45)' : '',
          ].filter(Boolean).join(', ') || undefined,
          overflow: 'visible',
        }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px',
          padding: '4px 8px', boxSizing: 'border-box',
          width: 'max-content', minWidth: b.width, maxWidth: LABEL_PX, overflow: 'hidden',
          color: 'var(--text-primary)', fontSize: '12px', fontWeight: 600,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: completed ? 'line-through' : 'none' }}>{tk.task_name}</span>
            <span style={{
              flexShrink: 0, fontSize: '9px', fontWeight: 800, letterSpacing: '0.03em', textTransform: 'uppercase',
              padding: '1px 5px', borderRadius: '6px', background: `${pColor}26`, color: pColor,
            }}>{pLabel}</span>
            {showAvatars && (tk.assignees ?? []).slice(0, 3).map((a, i) => (
              <div key={a.user_id} style={{ marginLeft: i === 0 ? 0 : '-6px', flexShrink: 0, border: '2px solid var(--bg-card)', borderRadius: '50%', display: 'flex' }}>
                <Avatar src={a.avatar} size={18} radius={9} iconColor="var(--accent-blue)" bg="rgba(59,130,246,0.16)" />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, color: 'var(--accent-teal)', fontSize: '10px', fontWeight: 600 }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stamp(b.start)}</span>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity: 0.85 }}>{stamp(b.end)}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          {[[<Minus key="m" size={14} />, () => zoomButton(1 / 1.4), t('Zoom out', 'Thu nhỏ')],
            [<Plus key="p" size={14} />, () => zoomButton(1.4), t('Zoom in', 'Phóng to')],
            [<Maximize2 key="f" size={13} />, fitAll, t('Fit', 'Vừa khung')]].map(([icon, fn, label], i) => (
            <button key={i} onClick={fn as () => void} title={label as string} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px',
              padding: '6px 9px', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex',
            }}>{icon as React.ReactNode}</button>
          ))}
        </div>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {t('Scroll to pan · Ctrl+scroll or buttons to zoom · drag to pan', 'Cuộn để di chuyển · Ctrl+cuộn hoặc nút để phóng to · kéo nền để di chuyển')}
          {canManage ? t(' · drag a block onto another to merge · right-click for actions', ' · kéo một khối lên khối khác để gộp · chuột phải để thao tác') : ''}
        </span>
      </div>

      {nothing ? (
        <div
          onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, task: null }) }}
          style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-light)', borderRadius: '12px', padding: '50px', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '15px', fontWeight: 600 }}>
            {tasks.length === 0 ? t('No tasks yet', 'Chưa có công việc') : t('No tasks match this filter', 'Không có công việc khớp bộ lọc')}
          </p>
          {tasks.length > 0 && (
            <button onClick={props.onResetFilters} style={{
              marginTop: '12px', background: 'var(--accent-blue)', color: 'white', border: 'none',
              borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}>{t('Show all tasks', 'Hiện tất cả công việc')}</button>
          )}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', background: 'var(--bg-card)' }}>
          {/* Scrollable canvas. Panning only mutates native scroll (no React
              re-render), so it stays smooth. The date axis is a sticky row
              inside, so it tracks horizontal scroll for free. */}
          <div
            ref={scrollRef}
            onMouseDown={startPan}
            onContextMenu={e => {
              e.preventDefault()
              const el = (e.target as HTMLElement).closest('[data-task-id]') as HTMLElement | null
              const tk = el ? tasks.find(x2 => x2.task_id === el.getAttribute('data-task-id')) ?? null : null
              // Time under the cursor (snapped to 15 min, kept inside the event)
              // so "New Task" on empty space can pre-fill the start.
              let time: number | undefined
              const c = contentRef.current
              if (!tk && c && pxPerDay > 0) {
                const rect = c.getBoundingClientRect()
                time = snapMs(evStart + ((e.clientX - rect.left) / pxPerDay) * DAY)
                // Keep the pre-filled start inside the event and never in the past.
                time = Math.max(evStart, now, Math.min(time, evEnd - 3 * HOUR))
              }
              setMenu({ x: e.clientX, y: e.clientY, task: tk, time })
            }}
            style={{
              position: 'relative', overflow: 'auto', height: panelH,
              cursor: panning ? 'grabbing' : 'grab',
            }}>
            <div ref={contentRef}
              onDragOver={onCanvasDragOver}
              onDrop={onCanvasDrop}
              style={{ position: 'relative', width: contentWidth, height: contentHeight }}>
              {/* minor gridlines (e.g. 15-minute marks) + major gridlines */}
              {minors.map((tk0, i) => (
                <div key={'mn' + i} style={{ position: 'absolute', left: x(tk0), top: 0, bottom: 0, width: '1px', background: 'var(--border)', opacity: 0.22 }} />
              ))}
              {majors.map((tk0, i) => (
                <div key={'mj' + i} style={{ position: 'absolute', left: x(tk0), top: 0, bottom: 0, width: '1px', background: 'var(--border)', opacity: 0.6 }} />
              ))}
              {/* sticky date axis */}
              <div style={{
                position: 'sticky', top: 0, left: 0, width: contentWidth, height: AXIS_H, zIndex: 6,
                background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
              }}>
                {majors.map((tk0, i) => (
                  <span key={i} style={{ position: 'absolute', left: x(tk0) + 3, top: '5px', fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {fmtTick(tk0)}
                  </span>
                ))}
              </div>
              {/* group bands */}
              {bands.map(bd => (
                <div key={bd.gid}
                  style={{
                    position: 'absolute', left: bd.left, top: bd.top, width: bd.width, height: bd.height,
                    borderRadius: '11px', border: `1px dashed ${dropKey === bd.gid ? 'var(--text-primary)' : 'var(--accent-purple)'}`,
                    background: 'rgba(139,92,246,0.06)',
                  }}>
                  {renaming === bd.gid ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 6px' }}>
                      <input autoFocus value={renameText} onChange={e => setRenameText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { props.onRenameGroup(bd.gid, renameText); setRenaming(null) } }}
                        onMouseDown={e => e.stopPropagation()}
                        placeholder={t('Group name', 'Tên nhóm')} style={{ padding: '2px 6px', fontSize: '11px', width: '140px' }} />
                      <button onMouseDown={e => e.stopPropagation()} onClick={() => { props.onRenameGroup(bd.gid, renameText); setRenaming(null) }} style={{ background: 'none', border: 'none', color: 'var(--accent-green)', display: 'flex', cursor: 'pointer' }}><Check size={13} /></button>
                      <button onMouseDown={e => e.stopPropagation()} onClick={() => setRenaming(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', display: 'flex', cursor: 'pointer' }}><X size={13} /></button>
                    </div>
                  ) : (
                    <div
                      onMouseDown={e => e.stopPropagation()}
                      onClick={() => { if (canManage) { setRenaming(bd.gid); setRenameText(bd.title) } }}
                      title={canManage ? t('Rename group', 'Đổi tên nhóm') : undefined}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px', cursor: canManage ? 'pointer' : 'default' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent-purple)', whiteSpace: 'nowrap' }}>
                        {bd.title || t('Untitled group', 'Nhóm chưa đặt tên')}
                      </span>
                      {canManage && <Pencil size={9} style={{ opacity: 0.7, color: 'var(--text-muted)' }} />}
                    </div>
                  )}
                </div>
              ))}
              {/* blocks */}
              {blocks.map(block)}
              {/* Live "now" line — the current date/time, so you can avoid
                  scheduling tasks into the past. Drawn on top of the blocks but
                  click-through (pointerEvents: none). Hidden when the event is
                  entirely in the future or already over. */}
              {pxPerDay > 0 && now >= evStart && now <= evEnd && (
                <div style={{
                  position: 'absolute', left: x(now), top: 0, bottom: 0, width: '2px',
                  background: 'var(--accent-blue)', zIndex: 7, pointerEvents: 'none',
                  boxShadow: '0 0 6px rgba(59,130,246,0.65)',
                }}>
                  {/* Pill sits at the bottom of the line, in the spare empty lane,
                      so it clears both the date/time ruler (top) and the group
                      titles / rename inputs. */}
                  <span style={{
                    position: 'absolute', bottom: '6px', left: '4px', whiteSpace: 'nowrap',
                    fontSize: '10px', fontWeight: 700, color: 'white',
                    background: 'var(--accent-blue)', padding: '1px 6px', borderRadius: '6px',
                  }}>{t('Now', 'Bây giờ')} · {stamp(now)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Unscheduled (no dates) */}
          {unscheduled.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px' }}>
              <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px' }}>{t('No dates set', 'Chưa đặt thời gian')}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {unscheduled.map(tk => {
                  const color = STATUS_COLOR[tk.status] || 'var(--text-muted)'
                  return (
                    <div key={tk.task_id} data-block data-task-id={tk.task_id}
                      draggable={canManage}
                      onDragStart={e => { if (canManage) { setDragId(tk.task_id); e.dataTransfer.setData('text/plain', tk.task_id) } }}
                      onDragEnd={() => setDragId(null)}
                      onClick={e => onBlockClick(tk.task_id, e)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '6px', height: ROW_H, minWidth: '150px', padding: '0 10px',
                        borderRadius: '8px', cursor: canManage ? 'grab' : 'pointer',
                        background: `${color}26`, border: `1.5px solid ${color}`, fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)',
                        boxShadow: selected.has(tk.task_id) ? '0 0 0 2px var(--accent-purple)' : undefined,
                      }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tk.task_name}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Right-click context menu */}
      {menu && (
        <>
          <div onMouseDown={() => setMenu(null)} onWheel={() => setMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 200 }} />
          <div style={{
            position: 'fixed', left: Math.min(menu.x, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 180), top: menu.y, zIndex: 201,
            background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '10px',
            boxShadow: '0 12px 30px rgba(0,0,0,0.4)', padding: '6px', minWidth: '160px',
          }}>
            {canManage && selected.size > 0 && (
              <>
                {menuItem(`${t('Delete selected', 'Xóa mục đã chọn')} (${selected.size})`, <Trash2 size={14} />, () => { props.onBatchDelete([...selected]); setSelected(new Set()); setMenu(null) }, 'var(--accent-red)')}
                {menuItem(`${t('Ungroup selected', 'Tách nhóm đã chọn')} (${selected.size})`, <Unlink size={14} />, () => { props.onBatchUngroup([...selected]); setSelected(new Set()); setMenu(null) })}
                <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }} />
              </>
            )}
            {menu.task ? (
              <>
                {menuItem(t('Edit', 'Sửa'), <Pencil size={14} />, () => { setEditTask(menu.task); setMenu(null) })}
                {canManage && menu.task.group_id && menuItem(t('Ungroup', 'Tách nhóm'), <Unlink size={14} />, () => { props.onUngroup(menu.task!.task_id); setMenu(null) })}
                {canManage && menuItem(t('Delete', 'Xóa'), <Trash2 size={14} />, () => { props.onDelete(menu.task!.task_id); setMenu(null) }, 'var(--accent-red)')}
              </>
            ) : (
              canManage
                ? menuItem(t('New Task', 'Tạo công việc'), <Plus size={14} />, () => { props.onNewTask(menu.time != null ? new Date(menu.time).toISOString() : undefined); setMenu(null) })
                : <div style={{ padding: '8px 10px', fontSize: '12px', color: 'var(--text-muted)' }}>{t('No actions', 'Không có thao tác')}</div>
            )}
          </div>
        </>
      )}

      {/* Edit panel (status / deadline / assignees only) */}
      {editTask && (() => {
        const tk = tasks.find(x2 => x2.task_id === editTask.task_id) ?? editTask
        const color = STATUS_COLOR[tk.status] || 'var(--text-muted)'
        return (
          <Modal title={tk.task_name} onClose={() => setEditTask(null)}>
            <div style={{ marginBottom: '12px' }}>
              <IdChip id={tk.task_id} />
            </div>
            {tk.group_title != null && (
              <p style={{ fontSize: '12px', color: 'var(--accent-purple)', fontWeight: 600, marginBottom: '12px' }}>
                {t('In group', 'Trong nhóm')}: {tk.group_title || t('Untitled group', 'Nhóm chưa đặt tên')}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {canManage && (
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>{t('Task name', 'Tên công việc')}</label>
                  <input
                    key={tk.task_id}
                    defaultValue={tk.task_name}
                    onBlur={e => { const v = e.target.value.trim(); if (v && v !== tk.task_name) props.onRename(tk.task_id, v) }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }}
                    style={{ width: '100%' }}
                  />
                </div>
              )}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>{t('Status', 'Trạng thái')}</label>
                <Dropdown fullWidth value={tk.status} onChange={v => props.onStatusChange(tk.task_id, v)}
                  options={[
                    { value: 'in_progress', label: t('In Progress', 'Đang làm'), color: STATUS_COLOR.in_progress },
                    { value: 'completed', label: t('Completed', 'Hoàn thành'), color: STATUS_COLOR.completed },
                    ...(tk.status === 'overdue' ? [{ value: 'overdue', label: t('Overdue', 'Quá hạn'), color: STATUS_COLOR.overdue }] : []),
                  ]} />
              </div>
              {canManage && (
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    {t('Priority', 'Ưu tiên')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({t('auto unless changed', 'tự động trừ khi chỉnh')})</span>
                  </label>
                  <Dropdown fullWidth value={tk.priority_label} onChange={v => props.onEditPriority(tk.task_id, v)}
                    options={[
                      { value: 'high', label: t('High', 'Cao'), color: 'var(--accent-red)' },
                      { value: 'medium', label: t('Medium', 'Trung bình'), color: 'var(--accent-amber)' },
                      { value: 'low', label: t('Low', 'Thấp'), color: 'var(--accent-green)' },
                    ]} />
                </div>
              )}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>{t('Start time', 'Thời gian bắt đầu')}</label>
                {canManage ? (() => {
                  const st = tk.start_time ? new Date(tk.start_time) : null
                  const p = (n: number) => String(n).padStart(2, '0')
                  const stDate = st ? `${st.getFullYear()}-${p(st.getMonth() + 1)}-${p(st.getDate())}` : ''
                  const stTime = st ? `${p(st.getHours())}:${p(st.getMinutes())}` : '08:00'
                  const combine = (date: string, time: string) => {
                    if (date && time) props.onStartChange(tk.task_id, new Date(`${date}T${time}`).toISOString())
                  }
                  return (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input type="date" value={stDate} onChange={e => combine(e.target.value, stTime)} style={{ width: 'auto' }} />
                      <TimePicker value={stTime} onChange={v => combine(stDate, v)} />
                    </div>
                  )
                })() : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    <Clock size={13} /> {fmtFull(tk.start_time)}
                  </span>
                )}
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>{t('Deadline', 'Hạn chót')}</label>
                {canManage ? (() => {
                  const dl = tk.deadline ? new Date(tk.deadline) : null
                  const p = (n: number) => String(n).padStart(2, '0')
                  const dlDate = dl ? `${dl.getFullYear()}-${p(dl.getMonth() + 1)}-${p(dl.getDate())}` : ''
                  const dlTime = dl ? `${p(dl.getHours())}:${p(dl.getMinutes())}` : '08:00'
                  const combine = (date: string, time: string) => {
                    if (date && time) props.onDeadlineChange(tk.task_id, new Date(`${date}T${time}`).toISOString())
                  }
                  return (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input type="date" value={dlDate} onChange={e => combine(e.target.value, dlTime)} style={{ width: 'auto' }} />
                      <TimePicker value={dlTime} onChange={v => combine(dlDate, v)} />
                    </div>
                  )
                })() : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', color }}>
                    <Clock size={13} /> {fmtFull(tk.deadline)}
                  </span>
                )}
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>{t('Assignees', 'Người được giao')}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  {(tk.assignees ?? []).length === 0
                    ? <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{t('None', 'Không có')}</span>
                    : (tk.assignees ?? []).map(a => (
                      <span key={a.user_id} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        <Avatar src={a.avatar} size={20} radius={10} iconColor="var(--accent-blue)" bg="rgba(59,130,246,0.16)" /> {a.name}
                      </span>
                    ))}
                  {canManage && (
                    <button onClick={() => { props.onEditAssignees(tk); setEditTask(null) }} style={{
                      marginLeft: 'auto', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: '7px',
                      padding: '5px 10px', fontSize: '12px', fontWeight: 600, color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: '5px',
                    }}><UsersIcon size={13} /> {t('Edit', 'Sửa')}</button>
                  )}
                </div>
              </div>
            </div>
          </Modal>
        )
      })()}
    </div>
  )

  function menuItem(label: string, icon: React.ReactNode, onClick: () => void, color?: string) {
    return (
      <button onClick={onClick} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: '9px', padding: '8px 10px',
        background: 'transparent', border: 'none', borderRadius: '7px', cursor: 'pointer',
        fontSize: '13px', fontWeight: 600, color: color || 'var(--text-primary)', textAlign: 'left',
      }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
        {icon} {label}
      </button>
    )
  }
}
