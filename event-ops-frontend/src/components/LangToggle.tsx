'use client'
import { useLang, Lang } from '@/context/LanguageContext'

// Inline SVG flags so they render consistently everywhere (emoji flags don't
// render as flags on Windows).
function FlagGB() {
  return (
    <svg viewBox="0 0 60 30" width="20" height="13" style={{ borderRadius: 2, display: 'block' }}>
      <clipPath id="gb-s"><path d="M0,0 v30 h60 v-30 z" /></clipPath>
      <clipPath id="gb-t"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" /></clipPath>
      <g clipPath="url(#gb-s)">
        <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
        <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#gb-t)" stroke="#C8102E" strokeWidth="4" />
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </svg>
  )
}

function FlagVN() {
  return (
    <svg viewBox="0 0 30 20" width="20" height="13" style={{ borderRadius: 2, display: 'block' }}>
      <rect width="30" height="20" fill="#da251d" />
      <polygon
        fill="#ff0"
        points="15,4 16.76,9.42 22.46,9.42 17.85,12.76 19.61,18.18 15,14.84 10.39,18.18 12.15,12.76 7.54,9.42 13.24,9.42"
      />
    </svg>
  )
}

export default function LangToggle() {
  const { lang, setLang } = useLang()

  const btn = (value: Lang, flag: React.ReactNode, label: string) => {
    const active = lang === value
    return (
      <button
        onClick={() => setLang(value)}
        title={value === 'en' ? 'English' : 'Tiếng Việt'}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          background: active ? 'var(--bg-hover)' : 'transparent',
          border: `1px solid ${active ? 'var(--border-light)' : 'transparent'}`,
          borderRadius: '7px', padding: '5px 9px',
          fontSize: '12px', fontWeight: active ? 700 : 500,
          color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        }}
      >
        {flag}
        {label}
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
      {btn('en', <FlagGB />, 'EN')}
      {btn('vi', <FlagVN />, 'VI')}
    </div>
  )
}
