'use client'
import { useEffect, useState, useCallback } from 'react'
import { io } from 'socket.io-client'
import { getWsUrl } from '@/lib/wsUrl'
import Fireworks from './Fireworks'

// Listens for `celebrate` broadcasts (a task/event was completed) and plays a
// brief fireworks burst once. Everyone currently in the app sees it.
export default function Celebration() {
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return
    const url = getWsUrl()
    const socket = url ? io(url, { auth: { token } }) : io({ auth: { token } })
    socket.on('connect', () => socket.emit('register'))
    socket.on('celebrate', () => setPlaying(true)) // ignored visually if already playing
    return () => { socket.disconnect() }
  }, [])

  const done = useCallback(() => setPlaying(false), [])
  return playing ? <Fireworks onDone={done} /> : null
}
