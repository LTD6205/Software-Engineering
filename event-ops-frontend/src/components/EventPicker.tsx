'use client'
import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check, Calendar } from 'lucide-react'
import { Event } from '@/lib/types'
import { useLang } from '@/context/LanguageContext'

interface Props {
  events: Event[]
  value: string
  onChange: (id: string) => void
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--accent-amber)',
  in_progress: 'var(--accent-blue)',
  completed: 'var(--accent-green)',
}

// A styled dropdown for choosing the active event (replaces a bare <select>):
// shows a status dot per event and its milestone %, with the current one ticked.
export default function EventPicker({ events, value, onChange }: Props) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const selected = events.find(e => e.event_id === value)
  const dot = (s: string) => (
    <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: STATUS_COLOR[s] || 'var(--text-muted)', flexShrink: 0 }} />
  )

  return (
    <div ref={ref} style={{ position: 'relative', minWidth: '260px', maxWidth: '380px', flex: 1 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '9px',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: '10px', padding: '10px 14px', cursor: 'pointer',
          fontSize: '13px', color: 'var(--text-primary)',
        }}>
        <Calendar size={15} color="var(--text-muted)" />
        {selected ? dot(selected.status) : null}
        <span style={{ flex: 1, textAlign: 'left', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected ? 'var(--text-primary)' : 'var(--text-muted)' }}>
          {selected ? selected.event_name : t('Select an event', 'Chọn sự kiện')}
        </span>
        <ChevronDown size={16} color="var(--text-muted)" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
          background: 'var(--bg-card)', border: '1px solid var(--border-light)',
          borderRadius: '11px', boxShadow: '0 12px 30px rgba(0,0,0,0.4)', zIndex: 40,
          maxHeight: '340px', overflowY: 'auto', padding: '6px',
        }}>
          {events.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
              {t('No events', 'Không có sự kiện')}
            </div>
          ) : events.map(e => {
            const pct = e.task_count ? Math.round(((e.completed_count ?? 0) / e.task_count) * 100) : 0
            const isSel = e.event_id === value
            return (
              <button key={e.event_id} onClick={() => { onChange(e.event_id); setOpen(false) }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '9px 11px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                  background: isSel ? 'var(--bg-hover)' : 'transparent', fontSize: '13px', color: 'var(--text-primary)',
                }}
                onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
                onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.background = isSel ? 'var(--bg-hover)' : 'transparent'}>
                {dot(e.status)}
                <span style={{ flex: 1, textAlign: 'left', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.event_name}
                </span>
                {e.task_count != null && e.task_count > 0 && (
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{pct}%</span>
                )}
                {isSel && <Check size={14} color="var(--accent-blue)" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
