'use client'
import { useState } from 'react'
import { Clock, Bot, Trash2, Pencil, UserPlus } from 'lucide-react'
import { Task } from '@/lib/types'
import { useLang } from '@/context/LanguageContext'
import StatusBadge from './StatusBadge'
import Avatar from './Avatar'
import Dropdown from './Dropdown'

interface Props {
  task: Task
  onStatusChange: (id: string, status: string) => void
  isCreator?: boolean
  canManage?: boolean
  onDelete?: (id: string) => void
  onDeadlineChange?: (id: string, isoDeadline: string) => void
  onEditAssignees?: (task: Task) => void
}

// Per-status accent colour + soft glow.
const STATUS: Record<string, { color: string; glow: string }> = {
  pending:     { color: 'var(--accent-amber)', glow: 'rgba(245,158,11,0.22)' },
  in_progress: { color: 'var(--accent-blue)',  glow: 'rgba(59,130,246,0.22)' },
  completed:   { color: 'var(--accent-green)', glow: 'rgba(34,197,94,0.20)' },
  overdue:     { color: 'var(--accent-red)',   glow: 'rgba(239,68,68,0.30)' },
}
const ORDER: Record<string, number> = { pending: 0, in_progress: 1, completed: 2 }

const toLocalInput = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function TaskCard({ task, onStatusChange, isCreator, canManage, onDelete, onDeadlineChange, onEditAssignees }: Props) {
  const { t, lang } = useLang()
  const [editingDeadline, setEditingDeadline] = useState(false)
  const assignees = task.assignees ?? []
  const canEditAssignees = canManage && !!onEditAssignees
  const fmt = (d: string) =>
    !d ? '—' : new Date(d).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  const isOverdue = task.status === 'overdue'
  const isCompleted = task.status === 'completed'
  const s = STATUS[task.status] || STATUS.pending
  const accent = isCompleted ? 'var(--border-light)' : s.color

  const statusLabel = (st: string) =>
    st === 'pending' ? t('Pending', 'Chờ xử lý')
    : st === 'in_progress' ? t('In Progress', 'Đang làm')
    : st === 'completed' ? t('Completed', 'Hoàn thành')
    : t('Overdue', 'Quá hạn')

  let options = ['pending', 'in_progress', 'completed']
  if (!isCreator) {
    options = options.filter(
      st => (st === 'in_progress' || st === 'completed') && (ORDER[st] ?? 0) >= (ORDER[task.status] ?? 0),
    )
  }
  if (!options.includes(task.status)) options = [task.status, ...options]

  return (
    <div
      className={isOverdue ? 'overdue-glow' : undefined}
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${isOverdue ? 'rgba(239,68,68,0.45)' : 'var(--border)'}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: '10px', padding: '14px 16px',
        opacity: isCompleted ? 0.6 : 1,
        boxShadow: isOverdue || isCompleted ? undefined : `0 0 14px ${s.glow}`,
        transition: 'opacity 0.2s, box-shadow 0.2s, border-color 0.2s',
      }}>
      {/* Assignee avatars, shown above the task. Clickable (for managers) to
          re-select who the task is assigned to. */}
      {(assignees.length > 0 || canEditAssignees) && (
        <div
          onClick={canEditAssignees ? () => onEditAssignees!(task) : undefined}
          title={canEditAssignees ? t('Change assignees', 'Đổi người được giao') : assignees.map(a => a.name).join(', ')}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px',
            cursor: canEditAssignees ? 'pointer' : 'default', width: 'fit-content',
          }}>
          {assignees.length > 0 ? (
            <>
              <div style={{ display: 'flex' }}>
                {assignees.slice(0, 5).map((a, i) => (
                  <div key={a.user_id} title={a.name}
                    style={{ marginLeft: i === 0 ? 0 : '-8px', border: '2px solid var(--bg-card)', borderRadius: '50%', display: 'flex' }}>
                    <Avatar src={a.avatar} size={26} radius={13} iconColor="var(--accent-blue)" bg="rgba(59,130,246,0.16)" />
                  </div>
                ))}
              </div>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {assignees.length === 1
                  ? assignees[0].name
                  : t(`${assignees.length} assignees`, `${assignees.length} người`)}
              </span>
            </>
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--accent-blue)', fontWeight: 600 }}>
              <UserPlus size={14} /> {t('Assign staff', 'Giao nhân viên')}
            </span>
          )}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
            <p className="selectable" style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', textDecoration: isCompleted ? 'line-through' : 'none' }}>{task.task_name}</p>
            {task.priority_source === 'ai' && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: 'var(--accent-purple)' }}>
                <Bot size={11} /> AI
              </span>
            )}
          </div>
          {task.description && (
            <p className="selectable" style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>{task.description}</p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {editingDeadline ? (
              <input
                type="datetime-local"
                autoFocus
                defaultValue={toLocalInput(task.deadline)}
                onBlur={() => setEditingDeadline(false)}
                onChange={e => {
                  if (e.target.value && onDeadlineChange) onDeadlineChange(task.task_id, new Date(e.target.value).toISOString())
                  setEditingDeadline(false)
                }}
                style={{ width: 'auto', padding: '4px 8px', fontSize: '12px' }}
              />
            ) : (
              <span
                onClick={() => { if (canManage && onDeadlineChange) setEditingDeadline(true) }}
                title={canManage ? t('Change deadline', 'Đổi hạn chót') : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px',
                  color: isOverdue ? 'var(--accent-red)' : 'var(--text-muted)',
                  cursor: canManage && onDeadlineChange ? 'pointer' : 'default',
                }}>
                <Clock size={12} />{fmt(task.deadline)}
                {canManage && onDeadlineChange && <Pencil size={10} style={{ opacity: 0.7 }} />}
              </span>
            )}
            <StatusBadge status={task.priority_label} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <StatusBadge status={task.status} />
            {canManage && onDelete && (
              <button onClick={() => onDelete(task.task_id)} title={t('Delete task', 'Xóa công việc')}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '2px', display: 'flex', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--accent-red)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <Dropdown
            size="sm"
            value={task.status}
            disabled={options.length <= 1}
            onChange={st => onStatusChange(task.task_id, st)}
            ariaLabel={t('Change status', 'Đổi trạng thái')}
            options={options.map(st => ({ value: st, label: statusLabel(st), color: (STATUS[st] || STATUS.pending).color }))}
          />
        </div>
      </div>
    </div>
  )
}
