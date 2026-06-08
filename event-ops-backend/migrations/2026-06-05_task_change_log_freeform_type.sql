-- task_change_log.change_type is now a free label (create|edit|delete|ungroup|
-- batch) — one row can capture a whole operation (an AI command or a multi-select
-- batch), so the old CHECK (change_type IN ('edit','delete')) is dropped. The undo
-- reads the snapshot's arrays, not change_type, so the label is purely cosmetic.
-- Idempotent. Apply with:  npm run db:migrate
ALTER TABLE task_change_log DROP CONSTRAINT IF EXISTS task_change_log_change_type_check;
