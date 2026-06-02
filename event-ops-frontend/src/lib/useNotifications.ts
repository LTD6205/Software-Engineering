'use client'
import { useState, useEffect, useCallback } from 'react'
import { notificationsApi } from './api'
import { Notification } from './types'
import { useSocket } from './useSocket'

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount]     = useState(0)
  // history = show all (read + unread); otherwise just unread.
  const [showHistory, setShowHistory]     = useState(false)

  // Read userId from localStorage (set by AuthContext on login). Computed lazily
  // so we don't need a mount effect that synchronously sets state.
  const [userId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    const stored = localStorage.getItem('user')
    return stored ? (JSON.parse(stored) as { user_id: string }).user_id : null
  })

  const fetchNotifications = useCallback(async () => {
    if (!userId) return
    try {
      const data = showHistory
        ? await notificationsApi.getAll(userId)
        : await notificationsApi.getUnread(userId)
      setNotifications(data)
      setUnreadCount(data.filter((n: Notification) => !n.is_read).length)
    } catch {}
  }, [userId, showHistory])

  // Initial load on mount. The state update lives in fetchNotifications' async
  // body, which is the intended place for it — fetching is exactly what this
  // effect exists to do.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchNotifications() }, [fetchNotifications])

  const handleIncoming = useCallback(() => {
    fetchNotifications()
  }, [fetchNotifications])

  useSocket(userId, handleIncoming)

  const markRead = async (id: string) => {
    await notificationsApi.markRead(id)
    fetchNotifications()
  }

  const markAllRead = async () => {
    if (!userId) return
    await notificationsApi.markAllRead(userId)
    fetchNotifications()
  }

  return {
    notifications, unreadCount, markRead, markAllRead,
    showHistory, setShowHistory, refresh: fetchNotifications,
  }
}