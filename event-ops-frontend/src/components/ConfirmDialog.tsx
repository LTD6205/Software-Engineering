'use client'
import { AlertTriangle } from 'lucide-react'

interface Props {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** A small styled confirmation dialog. Labels are passed in already-translated. */
export default function ConfirmDialog({
  open, title, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel,
}: Props) {
  if (!open) return null
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
      }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-light)',
        borderRadius: '14px', width: '100%', maxWidth: '400px', padding: '24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '9px',
            background: danger ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <AlertTriangle size={17} color={danger ? 'var(--accent-red)' : 'var(--accent-blue)'} />
          </div>
          <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</p>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '20px' }}>{message}</p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            background: 'var(--bg-hover)', color: 'var(--text-secondary)',
            border: '1px solid var(--border)', borderRadius: '8px',
            padding: '9px 16px', fontSize: '13px', fontWeight: 600,
          }}>{cancelLabel}</button>
          <button onClick={onConfirm} style={{
            background: danger ? 'var(--accent-red)' : 'var(--accent-blue)', color: 'white',
            border: 'none', borderRadius: '8px',
            padding: '9px 16px', fontSize: '13px', fontWeight: 600,
          }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
