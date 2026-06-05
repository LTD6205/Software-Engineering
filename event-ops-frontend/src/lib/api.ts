import axios from 'axios'

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api',
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT token to every request automatically
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
  }
  return config
})

// Global auth handling: a 401 means the token is missing/expired or the account
// was deactivated (the backend now re-checks the user on every request). Drop
// the stale session and send the user to login. A 403 (authenticated but not
// allowed) is left for the calling component to surface — it is not a logout.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (
      typeof window !== 'undefined' &&
      error?.response?.status === 401 &&
      !window.location.pathname.startsWith('/login')
    ) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  },
)

export const authApi = {
  // Validate the session and fetch the current server-side user (role/active
  // status reflect the DB, not whatever is cached in localStorage).
  me: () => api.get('/auth/me').then((r) => r.data),
}

export const eventsApi = {
  getAll:  ()                         => api.get('/events').then(r => r.data),
  create:  (data: object)             => api.post('/events', data).then(r => r.data),
  update:  (id: string, data: object) => api.put(`/events/${id}`, data).then(r => r.data),
  updateDates: (id: string, data: { start_time: string; end_time: string; task_strategy: 'delete' | 'shift' }) =>
    api.put(`/events/${id}/dates`, data).then(r => r.data),
  remove:  (id: string)               => api.delete(`/events/${id}`).then(r => r.data),
  availableManagers: ()                       => api.get('/events/available-managers').then(r => r.data),
  getManagers:       (id: string)             => api.get(`/events/${id}/managers`).then(r => r.data),
  addManager:        (id: string, mid: string) => api.post(`/events/${id}/managers`, { manager_id: mid }).then(r => r.data),
  removeManager:     (id: string, mid: string) => api.delete(`/events/${id}/managers/${mid}`).then(r => r.data),
}

export const tasksApi = {
  getByEvent:        (eventId: string)                => api.get(`/tasks/event/${eventId}`).then(r => r.data),
  create:            (data: object)                   => api.post('/tasks', data).then(r => r.data),
  update:            (id: string, data: object)       => api.put(`/tasks/${id}`, data).then(r => r.data),
  remove:            (id: string)                     => api.delete(`/tasks/${id}`).then(r => r.data),
  setAssignees:      (taskId: string, userIds: string[]) => api.put(`/tasks/${taskId}/assignments`, { user_ids: userIds }).then(r => r.data),
  // Merged tasks (groups)
  merge:        (sourceId: string, targetId: string) => api.post('/tasks/groups/merge', { source_id: sourceId, target_id: targetId }).then(r => r.data),
  addToGroup:   (groupId: string, taskId: string)     => api.post(`/tasks/groups/${groupId}/add`, { task_id: taskId }).then(r => r.data),
  ungroup:      (taskId: string)                       => api.delete(`/tasks/groups/tasks/${taskId}`).then(r => r.data),
  renameGroup:  (groupId: string, title: string)       => api.put(`/tasks/groups/${groupId}`, { title }).then(r => r.data),
  // Per-event undo history (3 most recent task changes) + undo the latest.
  changes:      (eventId: string)                      => api.get(`/tasks/event/${eventId}/changes`).then(r => r.data),
  undoLast:     (eventId: string)                      => api.post(`/tasks/event/${eventId}/undo`).then(r => r.data),
}

export const usersApi = {
  getAll: () => api.get('/users').then(r => r.data),
  directory: () => api.get('/users/directory').then(r => r.data),
  updateProfile: (data: object) => api.put('/users/me', data).then(r => r.data),
  create: (data: object) => api.post('/users', data).then(r => r.data),
  update: (id: string, data: object) => api.put(`/users/${id}`, data).then(r => r.data),
  // Staff → manager reassignment workflow
  reassignRequests: ()                              => api.get('/users/reassign-requests').then(r => r.data),
  reassign:        (staffId: string, mid: string)   => api.post(`/users/${staffId}/reassign`, { target_manager_id: mid }).then(r => r.data),
  acceptReassign:  (staffId: string)                => api.post(`/users/${staffId}/reassign/accept`).then(r => r.data),
  rejectReassign:  (staffId: string)                => api.post(`/users/${staffId}/reassign/reject`).then(r => r.data),
  cancelReassign:  (staffId: string)                => api.post(`/users/${staffId}/reassign/cancel`).then(r => r.data),
}

export const notificationsApi = {
  getUnread:   (userId: string) => api.get(`/notifications/user/${userId}`).then(r => r.data),
  getAll:      (userId: string) => api.get(`/notifications/user/${userId}/all`).then(r => r.data),
  markRead:    (id: string)     => api.put(`/notifications/${id}/read`).then(r => r.data),
  markAllRead: (userId: string) => api.put(`/notifications/user/${userId}/read-all`).then(r => r.data),
}

export const aiApi = {
  // The acting user (and its role) is derived from the JWT on the backend — no
  // userId in the body. `eventId` is optional: present on event-scoped views
  // (e.g. the tasks page), absent for cross-event commands ("create an event").
  command: (body: { eventId?: string; message: string; mode: 'auto' | 'ask'; history: { role: 'user' | 'assistant'; content: string }[] }) =>
    api.post('/ai/command', body).then((r) => r.data),
  confirm: (requestId: string) => api.post(`/ai/command/${requestId}/confirm`).then((r) => r.data),
  cancel: (requestId: string) => api.post(`/ai/command/${requestId}/cancel`).then((r) => r.data),
}

// Pull a human-readable message out of an unknown thrown error (usually an
// AxiosError) so callers don't need to type their catch clause as `any`.
export function getErrorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { message?: string })?.message || fallback
  }
  return fallback
}

export default api