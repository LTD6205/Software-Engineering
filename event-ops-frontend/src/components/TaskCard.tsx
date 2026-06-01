'use client'
import { useState } from 'react'
import { Clock, Bot, Trash2, Pencil } from 'lucide-react'
import { Task } from '@/lib/types'
import { useLang } from '@/context/LanguageContext'
import StatusBadge from './StatusBadge'

interface Props {
  task: Task
  onStatusChange: (id: string, status: string) => void
  isCreator?: boolean
  canManage?: boolean
  onDelete?: (id: string) => void
  onDeadlineChange?: (id: string, isoDeadline: string) => void
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

export default function TaskCard({ task, onStatusChange, isCreator, canManage, onDelete, onDeadlineChange }: Props) {
  const { t, lang } = useLang()
  const [editingDeadline, setEditingDeadline] = useState(false)
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
                style={{ fontSize: '11px', padding: '3px 6px', width: 'auto' }}
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
          <select value={task.status} onChange={e => { e.stopPropagation(); onStatusChange(task.task_id, e.target.value) }}
            disabled={options.length <= 1}
            style={{ fontSize: '11px', padding: '3px 6px', width: 'auto', cursor: options.length <= 1 ? 'not-allowed' : 'pointer' }}
            onClick={e => e.stopPropagation()}>
            {options.map(st => (
              <option key={st} value={st}>{statusLabel(st)}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
