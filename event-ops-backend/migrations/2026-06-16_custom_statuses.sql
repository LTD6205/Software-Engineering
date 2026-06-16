-- Feature 3: reusable per-event custom progress statuses.
--
-- A custom status is a display-only progress label that managers/staff define
-- per event and attach to tasks. It is layered ON TOP of the real status
-- lifecycle (in_progress/completed/overdue): the cron, priority automation, and
-- AI status handling never read it. Deleting a status detaches it from any task
-- (tasks.custom_status_id FK is ON DELETE SET NULL).
--
-- Apply with:  npm run db:migrate   (or paste into pgAdmin). Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS task_custom_statuses (
    status_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id    UUID                NOT NULL REFERENCES Events(event_id) ON DELETE CASCADE,
    name        VARCHAR(60)         NOT NULL,
    color       VARCHAR(20),
    created_by  UUID                REFERENCES Users(user_id) ON DELETE SET NULL,
    created_at  TIMESTAMP           NOT NULL DEFAULT NOW()
);

-- One status name per event (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS task_custom_statuses_event_name_uniq
    ON task_custom_statuses (event_id, lower(name));

-- The optional custom progress label on a task. Nullable; detached on status delete.
ALTER TABLE Tasks
    ADD COLUMN IF NOT EXISTS custom_status_id UUID
    REFERENCES task_custom_statuses(status_id) ON DELETE SET NULL;
