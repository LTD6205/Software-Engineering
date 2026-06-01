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

export const eventsApi = {
  getAll:  ()                         => api.get('/events').then(r => r.data),
  getOne:  (id: string)               => api.get(`/events/${id}`).then(r => r.data),
  create:  (data: object)             => api.post('/events', data).then(r => r.data),
  update:  (id: string, data: object) => api.put(`/events/${id}`, data).then(r => r.data),
  remove:  (id: string)               => api.delete(`/events/${id}`).then(r => r.data),
  availableManagers: ()                       => api.get('/events/available-managers').then(r => r.data),
  getManagers:       (id: string)             => api.get(`/events/${id}/managers`).then(r => r.data),
  addManager:        (id: string, mid: string) => api.post(`/events/${id}/managers`, { manager_id: mid }).then(r => r.data),
  removeManager:     (id: string, mid: string) => api.delete(`/events/${id}/managers/${mid}`).then(r => r.data),
}

export const tasksApi = {
  getByEvent:        (eventId: string)                => api.get(`/tasks/event/${eventId}`).then(r => r.data),
  getOne:            (id: string)                     => api.get(`/tasks/${id}`).then(r => r.data),
  create:            (data: object)                   => api.post('/tasks', data).then(r => r.data),
  update:            (id: string, data: object)       => api.put(`/tasks/${id}`, data).then(r => r.data),
  remove:            (id: string)                     => api.delete(`/tasks/${id}`).then(r => r.data),
  assign:            (taskId: string, userId: string) => api.post(`/tasks/${taskId}/assign`, { user_id: userId }).then(r => r.data),
  unassign:          (taskId: string, userId: string) => api.delete(`/tasks/${taskId}/assign/${userId}`).then(r => r.data),
  getMilestones:     (taskId: string)                 => api.get(`/tasks/${taskId}/milestones`).then(r => r.data),
  addMilestone:      (taskId: string, data: object)   => api.post(`/tasks/${taskId}/milestones`, data).then(r => r.data),
  completeMilestone: (milestoneId: string)            => api.put(`/tasks/milestones/${milestoneId}/complete`).then(r => r.data),
}

export const usersApi = {
  getAll: () => api.get('/users').then(r => r.data),
  directory: () => api.get('/users/directory').then(r => r.data),
  updateProfile: (data: object) => api.put('/users/me', data).then(r => r.data),
  getOne: (id: string) => api.get(`/users/${id}`).then(r => r.data),
  create: (data: object) => api.post('/users', data).then(r => r.data),
  update: (id: string, data: object) => api.put(`/users/${id}`, data).then(r => r.data),
  deactivate: (id: string) => api.put(`/users/${id}/deactivate`).then(r => r.data),
  // Staff → manager reassignment workflow
  reassignRequests: ()                              => api.get('/users/reassign-requests').then(r => r.data),
  reassign:        (staffId: string, mid: string)   => api.post(`/users/${staffId}/reassign`, { target_manager_id: mid }).then(r => r.data),
  acceptReassign:  (staffId: string)                => api.post(`/users/${staffId}/reassign/accept`).then(r => r.data),
  rejectReassign:  (staffId: string)                => api.post(`/users/${staffId}/reassign/reject`).then(r => r.data),
}

export const notificationsApi = {
  getUnread: (userId: string) => api.get(`/notifications/user/${userId}`).then(r => r.data),
  markRead:  (id: string)     => api.put(`/notifications/${id}/read`).then(r => r.data),
}

export const aiApi = {
  command: (userId: string, eventId: string, message: string) =>
    api.post('/ai/command', { userId, eventId, message }).then(r => r.data),
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