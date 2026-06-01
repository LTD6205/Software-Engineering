'use client'
import { useEffect } from 'react'
import { io } from 'socket.io-client'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || ''

export function useSocket(userId: string | null, onNotification: (data: object) => void) {
  useEffect(() => {
    if (!userId) return
    // With no explicit URL, connect to the page's own origin so traffic flows
    // through the Next.js /socket.io proxy (works behind a single ngrok tunnel).
    // Default transports allow polling to fall back through the HTTP proxy.
    const socket = WS_URL ? io(WS_URL) : io()
    socket.on('connect', () => { socket.emit('register', { userId }) })
    socket.on('notification', (data: object) => { onNotification(data) })
    return () => { socket.disconnect() }
  }, [userId, onNotification])
}