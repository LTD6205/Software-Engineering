'use client'
import { Calendar, Trash2, ChevronRight, Users } from 'lucide-react'
import { Event } from '@/lib/types'
import { useLang } from '@/context/LanguageContext'
import StatusBadge from './StatusBadge'

interface Props {
  event: Event
  onDelete: (id: string) => void
  onClick: (event: Event) => void
  canDelete?: boolean
  onManageMembers?: (event: Event) => void
}

// Status accent: pending=yellow, in_progress=blue, completed=green.
const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--accent-amber)',
  in_progress: 'var(--accent-blue)',
  completed: 'var(--accent-green)',
}

export default function EventCard({ event, onDelete, onClick, canDelete = true, onManageMembers }: Props) {
  const { t, lang } = useLang()
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const accent = STATUS_COLOR[event.status] || 'var(--accent-blue)'
  return (
    <div onClick={() => onClick(event)} style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderLeft: `3px solid ${accent}`,
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
        background: 'var(--bg-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Calendar size={18} color={accent} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="selectable" style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
          {event.event_name}
        </p>
        <p className="selectable" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {fmt(event.start_time)} — {fmt(event.end_time)}
        </p>
      </div>
      {event.people_count != null && (
        <span
          onClick={onManageMembers ? (e => { e.stopPropagation(); onManageMembers(event) }) : undefined}
          title={onManageMembers ? t('Manage members', 'Quản lý thành viên') : t('People in this event', 'Số người trong sự kiện')}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 600,
            color: 'var(--text-secondary)', background: 'var(--bg-hover)',
            padding: '4px 10px', borderRadius: '20px',
            border: `1px solid ${onManageMembers ? 'var(--border-light)' : 'var(--border)'}`,
            cursor: onManageMembers ? 'pointer' : 'default',
          }}>
          <Users size={13} /> {event.people_count}
        </span>
      )}
      <StatusBadge status={event.status} />
      {canDelete && (
        <button onClick={e => { e.stopPropagation(); onDelete(event.event_id) }}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '6px', borderRadius: '6px', display: 'flex' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--accent-red)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}>
          <Trash2 size={15} />
        </button>
      )}
      <ChevronRight size={15} color="var(--text-muted)" />
    </div>
  )
}