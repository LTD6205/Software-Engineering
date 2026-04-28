import axios from 'axios'

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api',
  headers: { 'Content-Type': 'application/json' },
})

export const eventsApi = {
  getAll:  ()                         => api.get('/events').then(r => r.data),
  getOne:  (id: string)               => api.get(`/events/${id}`).then(r => r.data),
  create:  (data: object)             => api.post('/events', data).then(r => r.data),
  update:  (id: string, data: object) => api.put(`/events/${id}`, data).then(r => r.data),
  remove:  (id: string)               => api.delete(`/events/${id}`).then(r => r.data),
}

export const tasksApi = {
  getByEvent:        (eventId: string)                => api.get(`/tasks/event/${eventId}`).then(r => r.data),
  getOne:            (id: string)                     => api.get(`/tasks/${id}`).then(r => r.data),
  create:            (data: object)                   => api.post('/tasks', data).then(r => r.data),
  update:            (id: string, data: object)       => api.put(`/tasks/${id}`, data).then(r => r.data),
  assign:            (taskId: string, userId: string) => api.post(`/tasks/${taskId}/assign`, { user_id: userId }).then(r => r.data),
  unassign:          (taskId: string, userId: string) => api.delete(`/tasks/${taskId}/assign/${userId}`).then(r => r.data),
  getMilestones:     (taskId: string)                 => api.get(`/tasks/${taskId}/milestones`).then(r => r.data),
  addMilestone:      (taskId: string, data: object)   => api.post(`/tasks/${taskId}/milestones`, data).then(r => r.data),
  completeMilestone: (milestoneId: string)            => api.put(`/tasks/milestones/${milestoneId}/complete`).then(r => r.data),
}

export const notificationsApi = {
  getUnread: (userId: string) => api.get(`/notifications/user/${userId}`).then(r => r.data),
  markRead:  (id: string)     => api.put(`/notifications/${id}/read`).then(r => r.data),
}

export const aiApi = {
  command: (userId: string, eventId: string, message: string) =>
    api.post('/ai/command', { userId, eventId, message }).then(r => r.data),
}

export default api