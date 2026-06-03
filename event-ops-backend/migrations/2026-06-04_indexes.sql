-- Add indexes for common filters that lacked them. Idempotent (IF NOT EXISTS).

-- Team lookups: "staff that report to manager X" (users.manager_id is queried by
-- the roster scope, deadline-recipient join, and reassignment cleanup).
CREATE INDEX IF NOT EXISTS idx_users_manager_id ON users(manager_id);

-- Directory / "active managers" lists filter by role (+ active status).
CREATE INDEX IF NOT EXISTS idx_users_role_active ON users(role, is_active);

-- Notification reads (per user, unread first) and event-scoped deletes.
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_event ON notifications(event_id);
