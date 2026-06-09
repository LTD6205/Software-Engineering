'use client'
import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { useLang } from '@/context/LanguageContext'

interface Props {
  id: string
  // Optional label shown before the id (e.g. "Task", "Event"); omitted by default.
  label?: string
}

// A compact, copyable identifier chip. Shows a short "#abcd1234" prefix; clicking
// copies the FULL id to the clipboard (so it can be pasted into an AI command),
// with the complete id in the tooltip. Stops propagation so copying never
// triggers the surrounding card's click / select / drag handlers.
export default function IdChip({ id, label }: Props) {
  const { t } = useLang()
  const [copied, setCopied] = useState(false)
  const short = id.slice(0, 8)

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard unavailable (e.g. insecure context) — the tooltip still shows
      // the full id so it can be copied manually.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      onMouseDown={e => e.stopPropagation()}
      title={`${id}\n${t('Click to copy ID', 'Nhấn để sao chép ID')}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '10px', fontWeight: 600, lineHeight: 1,
        color: copied ? 'var(--accent-green)' : 'var(--text-muted)',
        background: 'var(--bg-hover)',
        border: `1px solid ${copied ? 'var(--accent-green)' : 'var(--border)'}`,
        borderRadius: '6px', padding: '3px 6px', cursor: 'pointer',
        transition: 'color 0.15s, border-color 0.15s',
      }}>
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {label ? `${label} ` : ''}#{short}
    </button>
  )
}
