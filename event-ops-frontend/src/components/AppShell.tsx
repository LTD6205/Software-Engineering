'use client'
import { useAuth } from '@/context/AuthContext'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useLang } from '@/context/LanguageContext'
import Sidebar from './Sidebar'

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

  // Clear any highlighted text when clicking outside a selectable region.
  // Because most of the UI is user-select:none, the browser won't collapse an
  // existing selection on its own when you click a non-selectable element.
  useEffect(() => {
    const clearSelectionOnOutsideClick = (e: MouseEvent) => {
      const el = e.target as Element | null
      if (el && typeof el.closest === 'function' && el.closest('.selectable')) return
      const sel = window.getSelection?.()
      if (sel && !sel.isCollapsed) sel.removeAllRanges()
    }
    document.addEventListener('mousedown', clearSelectionOnOutsideClick)
    return () => document.removeEventListener('mousedown', clearSelectionOnOutsideClick)
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
        minHeight: '100vh', background: 'var(--bg-primary)',
      }}>
        {children}
      </main>
    </div>
  )
}