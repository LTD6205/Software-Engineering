'use client'
import { useLang } from '@/context/LanguageContext'

type Status = 'pending' | 'in_progress' | 'completed' | 'overdue' | 'low' | 'medium' | 'high'

const config: Record<Status, { bg: string; color: string; en: string; vi: string }> = {
  pending:     { bg: '#1e2d4a', color: '#60a5fa', en: 'Pending',     vi: 'Chờ xử lý' },
  in_progress: { bg: '#1e3a2e', color: '#34d399', en: 'In Progress', vi: 'Đang làm' },
  completed:   { bg: '#1a3320', color: '#22c55e', en: 'Completed',   vi: 'Hoàn thành' },
  overdue:     { bg: '#3a1a1a', color: '#f87171', en: 'Overdue',     vi: 'Quá hạn' },
  low:         { bg: '#1e2d4a', color: '#60a5fa', en: 'Low',         vi: 'Thấp' },
  medium:      { bg: '#2d2a1a', color: '#fbbf24', en: 'Medium',      vi: 'Trung bình' },
  high:        { bg: '#3a1a1a', color: '#f87171', en: 'High',        vi: 'Cao' },
}

export default function StatusBadge({ status }: { status: Status }) {
  const { t } = useLang()
  const c = config[status] || config.pending
  return (
    <span style={{
      background: c.bg, color: c.color,
      fontSize: '11px', fontWeight: 600,
      padding: '3px 8px', borderRadius: '12px',
      letterSpacing: '0.03em', whiteSpace: 'nowrap',
    }}>
      {t(c.en, c.vi)}
    </span>
  )
}
