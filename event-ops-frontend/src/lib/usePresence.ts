'use client'
import { useState, useEffect } from 'react'
import { io } from 'socket.io-client'
import { getWsUrl } from './wsUrl'

/**
 * Tracks which users are currently online (have a live socket connection).
 * The server broadcasts a `presence` event (an array of user IDs) whenever
 * anyone connects or disconnects. Returns a Set of online user IDs.
 */
export function usePresence(): Set<string> {
  const [online, setOnline] = useState<string[]>([])

  useEffect(() => {
    // The server identifies the user from the JWT in the handshake.
    const token = localStorage.getItem('token')
    const url = getWsUrl()
    const socket = url ? io(url, { auth: { token } }) : io({ auth: { token } })
    socket.on('connect', () => { socket.emit('register') })
    socket.on('presence', (ids: string[]) => setOnline(ids))
    return () => { socket.disconnect() }
  }, [])

  return new Set(online)
}
