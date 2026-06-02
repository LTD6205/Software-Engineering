-- Merged tasks: a "task group" is a named parent that several tasks belong to.
-- Tasks sharing a group_id render together on the timeline and share one span;
-- each member keeps its own status and assignees. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS task_groups (
    group_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id   UUID         NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
    title      VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP    NOT NULL DEFAULT NOW()
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS group_id UUID;

-- Dissolving a group just ungroups its tasks (does not delete them).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_group_id_fkey') THEN
        ALTER TABLE tasks ADD CONSTRAINT tasks_group_id_fkey
            FOREIGN KEY (group_id) REFERENCES task_groups(group_id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_group ON tasks(group_id);
