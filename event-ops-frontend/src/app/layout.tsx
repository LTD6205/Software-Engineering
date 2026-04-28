import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Sidebar from '@/components/Sidebar'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Event Ops — Intelligent Event Management',
  description: 'Intelligent Event Operations and Task Management System',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div style={{ display: 'flex', minHeight: '100vh' }}>
          <Sidebar />
          <main style={{
            marginLeft: '240px',
            flex: 1,
            minHeight: '100vh',
            background: 'var(--bg-primary)',
          }}>
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}