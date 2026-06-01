'use client'
import { useState, useEffect } from 'react'
import { io } from 'socket.io-client'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || ''

/**
 * Tracks which users are currently online (have a live socket connection).
 * The server broadcasts a `presence` event (an array of user IDs) whenever
 * anyone connects or disconnects. Returns a Set of online user IDs.
 */
export function usePresence(): Set<string> {
  const [online, setOnline] = useState<string[]>([])

  useEffect(() => {
    let userId: string | null = null
    const stored = localStorage.getItem('user')
    if (stored) {
      try { userId = (JSON.parse(stored) as { user_id: string }).user_id } catch {}
    }

    const socket = WS_URL ? io(WS_URL) : io()
    socket.on('connect', () => { if (userId) socket.emit('register', { userId }) })
    socket.on('presence', (ids: string[]) => setOnline(ids))
    return () => { socket.disconnect() }
  }, [])

  return new Set(online)
}
