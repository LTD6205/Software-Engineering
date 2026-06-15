'use client'
import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { useLang } from '@/context/LanguageContext'

interface Props {
  id: string
  // Optional label shown before the id (e.g. "Task", "Event"); omitted by default.
  label?: string
}

// Copy text to the clipboard, working in BOTH secure and insecure contexts.
// The async Clipboard API (navigator.clipboard) only exists in a secure context
// (HTTPS or localhost); the deployed app is served over plain HTTP, where it is
// undefined — so we fall back to the legacy execCommand('copy') via a hidden
// textarea. Returns true on success.
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
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
    if (await copyText(id)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }
    // If both copy paths fail, the tooltip still shows the full id to copy by hand.
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
