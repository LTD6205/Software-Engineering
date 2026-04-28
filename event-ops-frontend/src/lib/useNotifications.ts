'use client'
import { useState, useEffect, useCallback } from 'react'
import { notificationsApi } from './api'
import { Notification } from './types'
import { useSocket } from './useSocket'

const DEMO_USER_ID = '5f592659-2ecd-4eb1-a288-b45184bc73f1'

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount]     = useState(0)

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await notificationsApi.getUnread(DEMO_USER_ID)
      setNotifications(data)
      setUnreadCount(data.filter((n: Notification) => !n.is_read).length)
    } catch {}
  }, [])

  useEffect(() => { fetchNotifications() }, [fetchNotifications])

  const handleIncoming = useCallback((data: object) => {
    fetchNotifications()
    console.log('Live notification:', data)
  }, [fetchNotifications])

  useSocket(DEMO_USER_ID, handleIncoming)

  const markRead = async (id: string) => {
    await notificationsApi.markRead(id)
    fetchNotifications()
  }

  return { notifications, unreadCount, markRead, refresh: fetchNotifications }
}