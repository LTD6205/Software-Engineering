'use client'
import { useState, useRef, useEffect, type ReactNode } from 'react'
import { ChevronDown, Check } from 'lucide-react'

export interface DropdownOption {
  value: string
  label: string
  color?: string   // optional leading status/priority dot
}

interface Props {
  options: DropdownOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  icon?: ReactNode
  size?: 'sm' | 'md'      // sm = filter bars / cards, md = form fields
  fullWidth?: boolean     // stretch to the container (form fields)
  disabled?: boolean
  ariaLabel?: string
}

// One dropdown used everywhere (filters, forms, the task-status changer), so the
// button + popup-menu look and behaviour are identical across the app. Mirrors
// the EventPicker mechanism: a button that toggles a menu, ticks the current
// option, closes on outside click or selection.
export default function Dropdown({
  options, value, onChange, placeholder, icon,
  size = 'md', fullWidth = false, disabled = false, ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const selected = options.find(o => o.value === value)
  const pad = size === 'sm' ? '6px 10px' : '8px 12px'
  const fs = size === 'sm' ? '12px' : '14px'

  const dot = (c?: string) =>
    c ? <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: c, flexShrink: 0 }} /> : null

  return (
    <div ref={ref} style={{ position: 'relative', width: fullWidth ? '100%' : 'auto' }}>
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={e => { e.stopPropagation(); if (!disabled) setOpen(o => !o) }}
        style={{
          width: fullWidth ? '100%' : 'auto',
          display: 'flex', alignItems: 'center', gap: '8px',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: '8px', padding: pad, fontSize: fs, fontWeight: 600,
          color: selected ? 'var(--text-primary)' : 'var(--text-muted)',
          cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
        }}>
        {icon}
        {dot(selected?.color)}
        <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {selected ? selected.label : (placeholder ?? '')}
        </span>
        <ChevronDown size={15} color="var(--text-muted)"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
      </button>

      {open && !disabled && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: '100%',
          background: 'var(--bg-card)', border: '1px solid var(--border-light)',
          borderRadius: '10px', boxShadow: '0 12px 30px rgba(0,0,0,0.4)', zIndex: 60,
          maxHeight: '300px', overflowY: 'auto', padding: '6px', whiteSpace: 'nowrap',
        }}>
          {options.map(o => {
            const isSel = o.value === value
            return (
              <button key={o.value} type="button"
                onClick={e => { e.stopPropagation(); onChange(o.value); setOpen(false) }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '8px 10px', borderRadius: '7px', border: 'none', cursor: 'pointer',
                  fontSize: fs, color: 'var(--text-primary)',
                  background: isSel ? 'var(--bg-hover)' : 'transparent',
                }}
                onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
                onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.background = isSel ? 'var(--bg-hover)' : 'transparent'}>
                {dot(o.color)}
                <span style={{ flex: 1, textAlign: 'left' }}>{o.label}</span>
                {isSel && <Check size={14} color="var(--accent-blue)" style={{ flexShrink: 0 }} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
