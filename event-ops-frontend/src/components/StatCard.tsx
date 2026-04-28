import { LucideIcon } from 'lucide-react'

interface Props {
  label: string
  labelVi: string
  value: number | string
  icon: LucideIcon
  color: string
}

export default function StatCard({ label, labelVi, value, icon: Icon, color }: Props) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: '12px', padding: '20px',
      display: 'flex', alignItems: 'center', gap: '16px',
    }}>
      <div style={{
        width: '44px', height: '44px', borderRadius: '10px',
        background: color + '22',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon size={20} color={color} />
      </div>
      <div>
        <p style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
          {value}
        </p>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>{label}</p>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{labelVi}</p>
      </div>
    </div>
  )
}