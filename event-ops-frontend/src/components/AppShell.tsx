'use client'
import { useAuth } from '@/context/AuthContext'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import Sidebar from './Sidebar'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const pathname = usePathname()
  const router   = useRouter()

  useEffect(() => {
    if (!isLoading && !user && pathname !== '/login') {
      router.push('/login')
    }
  }, [user, isLoading, pathname, router])

  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh', background: 'var(--bg-primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading...</p>
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