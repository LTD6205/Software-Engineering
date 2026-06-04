'use client'
import { useEffect } from 'react'
import { X, AlertTriangle, Info } from 'lucide-react'

export interface ToastData {
  message: string
  kind?: 'error' | 'info'
}

// A small auto-dismissing banner used instead of the native alert() so error /
// notice feedback matches the app's styling. The parent owns the state and
// passes a STABLE onClose (wrap in useCallback) so the dismiss timer isn't
// reset on every render.
export default function Toast({
  data,
  onClose,
}: {
  data: ToastData | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!data) return
    const id = setTimeout(onClose, 4000)
    return () => clearTimeout(id)
  }, [data, onClose])

  if (!data) return null
  const error = data.kind !== 'info'
  const color = error ? 'var(--accent-red)' : 'var(--accent-blue)'
  return (
    <div role="alert" style={{
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      zIndex: 1000, display: 'flex', alignItems: 'center', gap: '10px',
      maxWidth: 'min(92vw, 460px)', padding: '12px 14px',
      background: 'var(--bg-card)', border: `1px solid ${color}`,
      borderLeft: `4px solid ${color}`, borderRadius: '10px',
      boxShadow: '0 12px 30px rgba(0,0,0,0.35)', color: 'var(--text-primary)',
      fontSize: '13px', fontWeight: 600, lineHeight: 1.4,
    }}>
      {error
        ? <AlertTriangle size={16} color={color} style={{ flexShrink: 0 }} />
        : <Info size={16} color={color} style={{ flexShrink: 0 }} />}
      <span style={{ flex: 1 }}>{data.message}</span>
      <button onClick={onClose} aria-label="Dismiss" style={{
        background: 'none', border: 'none', color: 'var(--text-muted)',
        display: 'flex', cursor: 'pointer', flexShrink: 0, padding: 0,
      }}><X size={15} /></button>
    </div>
  )
}
