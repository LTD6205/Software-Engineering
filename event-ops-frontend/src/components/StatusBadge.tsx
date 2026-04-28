type Status = 'pending' | 'in_progress' | 'completed' | 'overdue' | 'low' | 'medium' | 'high'

const config: Record<Status, { bg: string; color: string; label: string }> = {
  pending:     { bg: '#1e2d4a', color: '#60a5fa', label: 'Pending' },
  in_progress: { bg: '#1e3a2e', color: '#34d399', label: 'In Progress' },
  completed:   { bg: '#1a3320', color: '#22c55e', label: 'Completed' },
  overdue:     { bg: '#3a1a1a', color: '#f87171', label: 'Overdue' },
  low:         { bg: '#1e2d4a', color: '#60a5fa', label: 'Low' },
  medium:      { bg: '#2d2a1a', color: '#fbbf24', label: 'Medium' },
  high:        { bg: '#3a1a1a', color: '#f87171', label: 'High' },
}

export default function StatusBadge({ status }: { status: Status }) {
  const c = config[status] || config.pending
  return (
    <span style={{
      background: c.bg, color: c.color,
      fontSize: '11px', fontWeight: 600,
      padding: '3px 8px', borderRadius: '12px',
      letterSpacing: '0.03em', whiteSpace: 'nowrap',
    }}>
      {c.label}
    </span>
  )
}