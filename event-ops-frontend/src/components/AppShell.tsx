'use client'
import { useAuth } from '@/context/AuthContext'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useLang } from '@/context/LanguageContext'
import Sidebar from './Sidebar'
import Celebration from './Celebration'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const { t } = useLang()
  const pathname = usePathname()
  const router   = useRouter()

  useEffect(() => {
    if (!isLoading && !user && pathname !== '/login') {
      router.push('/login')
    }
  }, [user, isLoading, pathname, router])

  // When clicking outside selectable text / form fields, tidy up:
  //  - clear any highlighted text (the UI is user-select:none, so the browser
  //    won't collapse the selection on its own), and
  //  - blur a focused input/textarea so its blinking caret goes away (clicking
  //    a non-focusable panel doesn't move focus by itself).
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const el = e.target as Element | null
      const closest = (sel: string) =>
        el && typeof el.closest === 'function' ? el.closest(sel) : null

      if (!closest('.selectable')) {
        const sel = window.getSelection?.()
        if (sel && !sel.isCollapsed) sel.removeAllRanges()
      }

      if (!closest('input, textarea')) {
        const active = document.activeElement as HTMLElement | null
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
          active.blur()
        }
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh', background: 'var(--bg-primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>{t('Loading...', 'Đang tải...')}</p>
      </div>
    )
  }

  if (pathname === '/login') return <>{children}</>
  if (!user) return null

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{
        marginLeft: '240px', flex: 1,
        // min-width: 0 lets this flex item shrink to the viewport instead of
        // being pushed wider by scrollable content (e.g. the Tasks timeline),
        // which would add a second, page-level horizontal scrollbar.
        minWidth: 0,
        minHeight: '100vh', background: 'var(--bg-primary)',
      }}>
        {children}
      </main>
      <Celebration />
    </div>
  )
}