'use client'
import { useAuth } from '@/context/AuthContext'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Menu } from 'lucide-react'
import { useLang } from '@/context/LanguageContext'
import Sidebar from './Sidebar'
import Celebration from './Celebration'
import AiDrawer from './AiDrawer'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isManager, isAdmin, canManageEvents } = useAuth()
  const { t } = useLang()
  const pathname = usePathname()
  const router   = useRouter()
  // Mobile nav drawer (only surfaced ≤768px via CSS). Closed on every route
  // change so navigating from the drawer dismisses it.
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => {
    if (!isLoading && !user && pathname !== '/login') {
      router.push('/login')
    }
  }, [user, isLoading, pathname, router])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { setNavOpen(false) }, [pathname])
  /* eslint-enable react-hooks/set-state-in-effect */

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
      {/* Mobile-only top bar with the drawer toggle (hidden ≥768px via CSS). */}
      <header className="app-topbar">
        <button
          onClick={() => setNavOpen(v => !v)}
          aria-label={t('Toggle menu', 'Mở/đóng menu')}
          aria-expanded={navOpen}
          style={{
            background: 'transparent', border: 'none', padding: '6px',
            color: 'var(--text-primary)', display: 'flex', alignItems: 'center',
          }}
        >
          <Menu size={22} />
        </button>
        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>Event Ops</span>
      </header>

      {/* Dimming backdrop while the drawer is open (mobile only via CSS). */}
      {navOpen && <div className="app-overlay" onClick={() => setNavOpen(false)} aria-hidden="true" />}

      <Sidebar mobileOpen={navOpen} onNavigate={() => setNavOpen(false)} />
      <main className="app-main" style={{
        flex: 1,
        // min-width: 0 lets this flex item shrink to the viewport instead of
        // being pushed wider by scrollable content (e.g. the Tasks timeline),
        // which would add a second, page-level horizontal scrollbar.
        minWidth: 0,
        minHeight: '100vh', background: 'var(--bg-primary)',
      }}>
        {children}
      </main>
      <Celebration />
      {/* Global, route-aware AI surface (its own floating launcher + slide-over
          panel). Only roles that can act through the AI see it: managers/admins
          (tasks, team, AI) and organizers/admins (events). Staff are excluded. */}
      {(isManager || canManageEvents || isAdmin) && <AiDrawer />}
    </div>
  )
}