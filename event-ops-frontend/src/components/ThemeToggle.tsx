'use client'
import { Sun, Moon } from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'
import { useLang } from '@/context/LanguageContext'

export default function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const { t } = useLang()
  const dark = theme === 'dark'
  return (
    <button
      onClick={toggle}
      title={dark ? t('Switch to light mode', 'Chuyển sang nền sáng') : t('Switch to dark mode', 'Chuyển sang nền tối')}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', border: '1px solid var(--border)', borderRadius: '8px',
        padding: '6px 9px', color: 'var(--text-secondary)',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-light)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}>
      {dark ? <Moon size={15} /> : <Sun size={15} />}
    </button>
  )
}
