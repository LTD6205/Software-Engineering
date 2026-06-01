'use client'
import { useEffect } from 'react'
import { io } from 'socket.io-client'
import { getWsUrl } from './wsUrl'

export function useSocket(userId: string | null, onNotification: (data: object) => void) {
  useEffect(() => {
    if (!userId) return
    // Send the JWT in the handshake; the server derives the user from it.
    const token = localStorage.getItem('token')
    const url = getWsUrl()
    const socket = url ? io(url, { auth: { token } }) : io({ auth: { token } })
    socket.on('connect', () => { socket.emit('register') })
    socket.on('notification', (data: object) => { onNotification(data) })
    return () => { socket.disconnect() }
  }, [userId, onNotification])
}