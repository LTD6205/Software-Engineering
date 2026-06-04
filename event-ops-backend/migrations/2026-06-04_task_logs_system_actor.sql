-- Migration: allow a 'system' actor in task_logs.
--
-- Why: the deadline cron (notifications.service.ts) flips tasks to 'overdue' on
-- its own, but the original task_logs CHECK only permitted
--   actor_type IN ('user', 'ai')
-- and required a matching actor id for each — so a system-driven transition
-- could not be recorded at all. This widens both CHECKs so a 'system' row
-- (neither actor_user_id nor ai_request_id set) is valid, making cron-driven
-- status changes auditable in task_logs alongside user/AI changes.
--
-- Safe to run repeatedly: it drops every CHECK on task_logs that mentions
-- actor_type (the auto-named column check and the named actor check), then
-- recreates both with the widened rules.
--
-- Apply with:  npm run db:migrate      (or paste this whole file into pgAdmin)

DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'task_logs'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%actor_type%'
  LOOP
    EXECUTE format('ALTER TABLE task_logs DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE task_logs ADD CONSTRAINT task_logs_actor_type_check
  CHECK (actor_type IN ('user', 'ai', 'system'));

ALTER TABLE task_logs ADD CONSTRAINT task_logs_actor_check CHECK (
  (actor_type = 'user'   AND actor_user_id IS NOT NULL AND ai_request_id IS NULL) OR
  (actor_type = 'ai'     AND ai_request_id IS NOT NULL AND actor_user_id IS NULL) OR
  (actor_type = 'system' AND actor_user_id IS NULL     AND ai_request_id IS NULL)
);
