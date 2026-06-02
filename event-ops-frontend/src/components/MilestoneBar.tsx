'use client'
import { useLang } from '@/context/LanguageContext'

interface Props {
  completed: number
  total: number
  // compact hides the "x/y tasks" caption (used on dense cards).
  compact?: boolean
}

/**
 * Event milestone tracker: progress = completed tasks / total tasks.
 * 0% when there are no tasks (or all were deleted); 100% when all are completed.
 */
export default function MilestoneBar({ completed, total, compact }: Props) {
  const { t } = useLang()
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  const color =
    pct >= 100 ? 'var(--accent-green)'
    : pct > 0  ? 'var(--accent-blue)'
    : 'var(--text-muted)'

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
          {t('Milestone', 'Tiến độ')}
        </span>
        <span style={{ fontSize: '11px', fontWeight: 700, color }}>
          {pct}%{!compact && total > 0 ? ` · ${completed}/${total} ${t('tasks', 'công việc')}` : ''}
        </span>
      </div>
      <div style={{
        width: '100%', height: '6px', borderRadius: '999px',
        background: 'var(--bg-hover)', overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: '999px',
          background: color, transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  )
}
