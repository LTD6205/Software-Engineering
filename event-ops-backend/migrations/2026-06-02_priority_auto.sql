-- Allow an 'auto' priority source. Managers no longer set task priority; it's
-- derived from where the task sits in the event's timeline (earliest third =
-- High → Medium → Low) and recomputed when tasks change. A manual edit flips
-- the source to 'user' so auto-recompute leaves it alone. Idempotent.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_priority_source_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_priority_source_check
    CHECK (priority_source IN ('user', 'ai', 'auto'));
