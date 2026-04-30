'use client'
import { useState, useEffect, useCallback } from 'react'
import { notificationsApi } from './api'
import { Notification } from './types'
import { useSocket } from './useSocket'

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount]     = useState(0)
  const [userId, setUserId]               = useState<string | null>(null)

  // Get userId from localStorage (set by AuthContext on login)
  useEffect(() => {
    const stored = localStorage.getItem('user')
    if (stored) {
      const u = JSON.parse(stored)
      setUserId(u.user_id)
    }
  }, [])

  const fetchNotifications = useCallback(async () => {
    if (!userId) return
    try {
      const data = await notificationsApi.getUnread(userId)
      setNotifications(data)
      setUnreadCount(data.filter((n: Notification) => !n.is_read).length)
    } catch {}
  }, [userId])

  useEffect(() => { fetchNotifications() }, [fetchNotifications])

  const handleIncoming = useCallback(() => {
    fetchNotifications()
  }, [fetchNotifications])

  useSocket(userId, handleIncoming)

  const markRead = async (id: string) => {
    await notificationsApi.markRead(id)
    fetchNotifications()
  }

  return { notifications, unreadCount, markRead, refresh: fetchNotifications }
}