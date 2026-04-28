'use client'
import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3000'

export function useSocket(userId: string | null, onNotification: (data: object) => void) {
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    if (!userId) return
    const socket = io(WS_URL, { transports: ['websocket'] })
    socketRef.current = socket
    socket.on('connect', () => { socket.emit('register', { userId }) })
    socket.on('notification', (data: object) => { onNotification(data) })
    return () => { socket.disconnect() }
  }, [userId, onNotification])

  return socketRef.current
}