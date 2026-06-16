'use client'
import { useMemo } from 'react'
import { Link2, Trash2, Users } from 'lucide-react'
import { Task, CustomStatus } from '@/lib/types'
import { useLang } from '@/context/LanguageContext'
import Avatar from './Avatar'
import Dropdown from './Dropdown'

// Sort keys offered in the list view. priority maps to priority_score so the
// order matches the timeline's High→Low ranking.
export type SortKey = 'priority' | 'deadline' | 'start' | 'name'
export type SortDir = 'asc' | 'desc'

const STATUS_META: Record<string, { en: string; vi: string; color: string }> = {
  in_progress: { en: 'In Progress', vi: 'Đang làm', color: 'var(--accent-blue)' },
  completed: { en: 'Completed', vi: 'Hoàn thành', color: 'var(--accent-green)' },
  overdue: { en: 'Overdue', vi: 'Quá hạn', color: 'var(--accent-red)' },
  pending: { en: 'Pending', vi: 'Chờ', color: 'var(--accent-amber)' },
}
const PRIORITY_COLOR: Record<string, string> = {
  high: 'var(--accent-red)',
  medium: 'var(--accent-amber)',
  low: 'var(--accent-green)',
}

function fmt(dt?: string): string {
  if (!dt) return '—'
  const d = new Date(dt)
  if (isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

interface Props {
  tasks: Task[]
  customStatuses: CustomStatus[]
  canManage: boolean
  // Which tasks the current user may edit (creator or assignee). When false the
  // row's status/custom-status controls render read-only (linked tasks for staff).
  canEdit: (tk: Task) => boolean
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  onStatusChange: (id: string, status: string) => void
  onSetCustomStatus: (id: string, statusId: string | null) => void
  onEditAssignees: (tk: Task) => void
  onOpenLinks: (tk: Task) => void
  onDelete: (id: string) => void
}

export default function TaskList({
  tasks,
  customStatuses,
  canManage,
  canEdit,
  sortKey,
  sortDir,
  onSort,
  onStatusChange,
  onSetCustomStatus,
  onEditAssignees,
  onOpenLinks,
  onDelete,
}: Props) {
  const { t } = useLang()
  const statusById = useMemo(() => {
    const m = new Map<string, CustomStatus>()
    for (const s of customStatuses) m.set(s.status_id, s)
    return m
  }, [customStatuses])

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
  const th = (key: SortKey, en: string, vi: string) => (
    <th
      onClick={() => onSort(key)}
      style={{
        textAlign: 'left', padding: '10px 12px', fontSize: '12px', fontWeight: 600,
        color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
    >
      {t(en, vi)}{arrow(key)}
    </th>
  )

  if (tasks.length === 0) {
    return (
      <p style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '20px 4px' }}>
        {t('No tasks match the current filters', 'Không có công việc khớp bộ lọc')}
      </p>
    )
  }

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: '12px', overflow: 'hidden', overflowX: 'auto',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-hover)' }}>
            {th('name', 'Task', 'Công việc')}
            <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>{t('Status', 'Trạng thái')}</th>
            <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>{t('Progress', 'Tiến độ')}</th>
            {th('priority', 'Priority', 'Ưu tiên')}
            <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>{t('Assignees', 'Người được giao')}</th>
            {th('start', 'Start', 'Bắt đầu')}
            {th('deadline', 'Deadline', 'Hạn chót')}
            <th style={{ padding: '10px 12px' }} />
          </tr>
        </thead>
        <tbody>
          {tasks.map(tk => {
            const editable = canEdit(tk)
            const sm = STATUS_META[tk.status] ?? { en: tk.status, vi: tk.status, color: 'var(--text-muted)' }
            const cs = tk.custom_status_id ? statusById.get(tk.custom_status_id) : undefined
            return (
              <tr key={tk.task_id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {tk.task_name}
                  {tk.group_title ? (
                    <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>· {tk.group_title}</span>
                  ) : null}
                  {!editable && (
                    <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>({t('linked', 'liên kết')})</span>
                  )}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  {editable ? (
                    <Dropdown size="sm" value={tk.status} onChange={v => onStatusChange(tk.task_id, v)}
                      ariaLabel={t('Change status', 'Đổi trạng thái')}
                      options={[
                        { value: 'in_progress', label: t('In Progress', 'Đang làm'), color: 'var(--accent-blue)' },
                        { value: 'completed', label: t('Completed', 'Hoàn thành'), color: 'var(--accent-green)' },
                        ...(tk.status === 'overdue' ? [{ value: 'overdue', label: t('Overdue', 'Quá hạn'), color: 'var(--accent-red)' }] : []),
                      ]} />
                  ) : (
                    <span style={{ color: sm.color, fontWeight: 600 }}>{t(sm.en, sm.vi)}</span>
                  )}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  {editable ? (
                    <Dropdown size="sm" value={tk.custom_status_id ?? ''} onChange={v => onSetCustomStatus(tk.task_id, v || null)}
                      ariaLabel={t('Set progress label', 'Đặt nhãn tiến độ')}
                      options={[
                        { value: '', label: t('— none —', '— không —') },
                        ...customStatuses.map(s => ({ value: s.status_id, label: s.name, color: s.color ?? undefined })),
                      ]} />
                  ) : cs ? (
                    <span style={{
                      fontSize: '12px', fontWeight: 600, padding: '2px 8px', borderRadius: '999px',
                      color: cs.color ?? 'var(--text-secondary)',
                      background: 'var(--bg-hover)', border: '1px solid var(--border)',
                    }}>{cs.name}</span>
                  ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{ color: PRIORITY_COLOR[tk.priority_label] ?? 'var(--text-muted)', fontWeight: 600, textTransform: 'capitalize' }}>
                    {tk.priority_label}
                  </span>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <button
                    onClick={() => canManage && onEditAssignees(tk)}
                    disabled={!canManage}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: canManage ? 'pointer' : 'default', padding: 0 }}
                    title={t('Edit assignees', 'Sửa người được giao')}
                  >
                    {(tk.assignees ?? []).length === 0 ? (
                      <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Users size={14} /> {t('none', 'chưa có')}
                      </span>
                    ) : (
                      (tk.assignees ?? []).slice(0, 4).map(a => (
                        <Avatar key={a.user_id} src={a.avatar} size={24} radius={12} iconColor="var(--accent-blue)" bg="rgba(59,130,246,0.16)" />
                      ))
                    )}
                  </button>
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmt(tk.start_time)}</td>
                <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmt(tk.deadline)}</td>
                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                  <button onClick={() => onOpenLinks(tk)} title={t('Linked tasks', 'Công việc liên kết')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}>
                    <Link2 size={15} />
                  </button>
                  {canManage && (
                    <button onClick={() => onDelete(tk.task_id)} title={t('Delete', 'Xóa')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: '4px' }}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
