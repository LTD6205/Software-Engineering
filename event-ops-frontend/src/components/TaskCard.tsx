'use client'
import { Clock, Bot } from 'lucide-react'
import { Task } from '@/lib/types'
import { useLang } from '@/context/LanguageContext'
import StatusBadge from './StatusBadge'

interface Props {
  task: Task
  onStatusChange: (id: string, status: string) => void
  isCreator?: boolean
}

// Per-status accent colour + soft glow. pending=yellow, in_progress=blue,
// completed=green, overdue=red.
const STATUS: Record<string, { color: string; glow: string }> = {
  pending:     { color: 'var(--accent-amber)', glow: 'rgba(245,158,11,0.22)' },
  in_progress: { color: 'var(--accent-blue)',  glow: 'rgba(59,130,246,0.22)' },
  completed:   { color: 'var(--accent-green)', glow: 'rgba(34,197,94,0.20)' },
  overdue:     { color: 'var(--accent-red)',   glow: 'rgba(239,68,68,0.30)' },
}
const ORDER: Record<string, number> = { pending: 0, in_progress: 1, completed: 2 }

export default function TaskCard({ task, onStatusChange, isCreator }: Props) {
  const { t, lang } = useLang()
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

  // Which statuses this user may pick. Creator: any. Otherwise (assigned staff):
  // only forward to In Progress / Completed — never backwards.
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
            <span className="selectable" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: isOverdue ? 'var(--accent-red)' : 'var(--text-muted)' }}>
              <Clock size={12} />{fmt(task.deadline)}
            </span>
            <StatusBadge status={task.priority_label} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
          <StatusBadge status={task.status} />
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
