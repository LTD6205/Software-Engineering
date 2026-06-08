-- Bounded, delete-surviving undo history for task changes within an event.
--
-- Each row is one undoable OPERATION (a manual action, one AI command, or one
-- batch/multi-select action). snapshot captures whatever it did — created ids,
-- deleted task snapshots, edited old-values, and/or ungrouped memberships — and
-- undo reverses all of it. The app keeps only the 3 newest rows per event (pruned
-- on write) and the undo button / AI undo reverts the most recent one.
--
-- There is deliberately NO foreign key from task_id to tasks: a deletion's row
-- must outlive the task it describes (task_logs, which DOES cascade on task
-- delete, can't be used for undoing deletions). event_id cascades so an event's
-- history is cleaned up with the event.
--
-- Apply with:  npm run db:migrate   (or paste into pgAdmin). Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS task_change_log (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id      UUID                NOT NULL REFERENCES Events(event_id) ON DELETE CASCADE,
    task_id       UUID,                           -- may outlive the task (delete)
    change_type   VARCHAR(10)         NOT NULL,   -- free label: create|edit|delete|ungroup|batch
    label         TEXT,                           -- human summary for the undo button
    snapshot      JSONB               NOT NULL,   -- {created?,deleted?,edited?,ungrouped?} — see entity
    actor_user_id UUID,
    created_at    TIMESTAMP           NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_change_log_event
    ON task_change_log(event_id, created_at DESC);
