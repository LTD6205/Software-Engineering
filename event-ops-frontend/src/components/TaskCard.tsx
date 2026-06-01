'use client'
import { Clock, Bot } from 'lucide-react'
import { Task } from '@/lib/types'
import { useLang } from '@/context/LanguageContext'
import StatusBadge from './StatusBadge'

interface Props {
  task: Task
  onStatusChange: (id: string, status: string) => void
}

const priorityColor: Record<string, string> = {
  high: 'var(--accent-red)', medium: 'var(--accent-amber)', low: 'var(--accent-blue)',
}

export default function TaskCard({ task, onStatusChange }: Props) {
  const { t, lang } = useLang()
  const isOverdue = task.status === 'overdue'
  const fmt = (d: string) =>
    !d ? '—' : new Date(d).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${isOverdue ? '#3a1a1a' : 'var(--border)'}`,
      borderLeft: `3px solid ${priorityColor[task.priority_label] || 'var(--accent-blue)'}`,
      borderRadius: '10px', padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
            <p className="selectable" style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{task.task_name}</p>
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
            style={{ fontSize: '11px', padding: '3px 6px', width: 'auto', cursor: 'pointer' }}
            onClick={e => e.stopPropagation()}>
            <option value="pending">{t('Pending', 'Chờ xử lý')}</option>
            <option value="in_progress">{t('In Progress', 'Đang làm')}</option>
            <option value="completed">{t('Completed', 'Hoàn thành')}</option>
            {/* Only present so an overdue task shows its real status; set by the system */}
            {isOverdue && <option value="overdue">{t('Overdue', 'Quá hạn')}</option>}
          </select>
        </div>
      </div>
    </div>
  )
}