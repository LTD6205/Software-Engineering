'use client'
import { useEffect } from 'react'
import { io } from 'socket.io-client'
import { getWsUrl } from './wsUrl'

export interface DataChange {
  kind: 'task' | 'event'
  event_id?: string
}

/**
 * Subscribes to server "data_changed" broadcasts so a page can refetch live
 * when someone else creates/updates/deletes a task or event (e.g. a staff
 * completing the last task flips the event to completed for everyone watching).
 * Pass a STABLE callback (wrap in useCallback) to avoid reconnecting each render.
 */
export function useLiveData(onChange: (change: DataChange) => void) {
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    const url = getWsUrl()
    const socket = url ? io(url, { auth: { token } }) : io({ auth: { token } })
    socket.on('connect', () => { socket.emit('register') })
    socket.on('data_changed', (data: DataChange) => { onChange(data) })
    return () => { socket.disconnect() }
  }, [onChange])
}
