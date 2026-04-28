'use client'
import { Calendar, Trash2, ChevronRight } from 'lucide-react'
import { Event } from '@/lib/types'
import StatusBadge from './StatusBadge'

interface Props {
  event: Event
  onDelete: (id: string) => void
  onClick: (event: Event) => void
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function EventCard({ event, onDelete, onClick }: Props) {
  return (
    <div onClick={() => onClick(event)} style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: '12px', padding: '16px 20px',
      display: 'flex', alignItems: 'center', gap: '16px',
      cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
    }}
    onMouseEnter={e => {
      (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-light)'
      ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'
    }}
    onMouseLeave={e => {
      (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
      ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-card)'
    }}>
      <div style={{
        width: '40px', height: '40px', borderRadius: '10px',
        background: '#1e2d4a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Calendar size={18} color="var(--accent-blue)" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
          {event.event_name}
        </p>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {fmt(event.start_time)} — {fmt(event.end_time)}
        </p>
      </div>
      <StatusBadge status={event.status} />
      <button onClick={e => { e.stopPropagation(); onDelete(event.event_id) }}
        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '6px', borderRadius: '6px', display: 'flex' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--accent-red)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}>
        <Trash2 size={15} />
      </button>
      <ChevronRight size={15} color="var(--text-muted)" />
    </div>
  )
}