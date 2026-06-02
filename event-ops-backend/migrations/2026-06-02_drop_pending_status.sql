-- Tasks no longer have a "pending" stage: a new task starts In Progress and
-- moves to Completed. Migrate any existing pending tasks and change the default.
-- (Event status still uses 'pending' for an event with no tasks — untouched.)
-- Idempotent.
UPDATE tasks SET status = 'in_progress' WHERE status = 'pending';
ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'in_progress';
