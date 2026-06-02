export interface User {
  user_id: string
  name: string
  email: string
  role: 'manager' | 'staff' | 'admin' | 'eventmanager'
  created_at: string
}

export interface Event {
  event_id: string
  event_name: string
  description: string
  start_time: string
  end_time: string
  created_by: string
  status: 'pending' | 'in_progress' | 'completed'
  created_at: string
  manager_count?: number
  people_count?: number
  task_count?: number
  completed_count?: number
}

export interface ManagerOption {
  user_id: string
  name: string
  email?: string
  team_count: number
}

export interface Assignee {
  user_id: string
  name: string
  avatar?: string | null
}

export interface Task {
  task_id: string
  event_id: string
  task_name: string
  description: string
  priority_label: 'low' | 'medium' | 'high'
  priority_score: number
  priority_source: 'user' | 'ai'
  status: 'pending' | 'in_progress' | 'completed' | 'overdue'
  start_time: string
  deadline: string
  created_by: string
  created_at: string
  assignees?: Assignee[]
  // Merged-task grouping: non-null group_id means this task shares a span with
  // its group mates; group_title is the parent label.
  group_id?: string | null
  group_title?: string | null
}

export interface Notification {
  notification_id: string
  user_id: string
  task_id: string | null
  type: 'reminder' | 'alert' | 'overdue' | 'event' | 'task' | 'reassignment' | 'info'
  message: string
  is_read: boolean
  created_at: string
}

export interface AiCommandResult {
  status: 'success' | 'rejected'
  tasks_created?: Task[]
  reason?: object
}