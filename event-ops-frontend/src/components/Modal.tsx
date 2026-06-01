'use client'
import { useRef } from 'react'
import { X } from 'lucide-react'

interface Props {
  title: string
  onClose: () => void
  children: React.ReactNode
}

export default function Modal({ title, onClose, children }: Props) {
  // Only close on a real backdrop click — i.e. the mouse was both pressed AND
  // released on the backdrop itself. This prevents the modal from closing when
  // you select text inside and release the mouse outside the box.
  const pressedOnBackdrop = useRef(false)

  return (
    <div
      onMouseDown={e => { pressedOnBackdrop.current = e.target === e.currentTarget }}
      onClick={e => {
        if (e.target === e.currentTarget && pressedOnBackdrop.current) onClose()
        pressedOnBackdrop.current = false
      }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
      }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-light)',
        borderRadius: '16px', width: '100%', maxWidth: '520px',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px', borderBottom: '1px solid var(--border)',
        }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</h2>
          <button onClick={onClose} style={{
            background: 'none', border: 'none',
            color: 'var(--text-muted)', padding: '4px', borderRadius: '6px', display: 'flex',
          }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: '24px' }}>{children}</div>
      </div>
    </div>
  )
}