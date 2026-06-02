-- Migration: make task/event child foreign keys ON DELETE CASCADE.
--
-- Why: the original schema declared these FKs with no ON DELETE action, so the
-- database REFUSED to delete a task (or event) while any child row still
-- referenced it. The app worked around that by manually deleting every child
-- row first. This migration lets the database clean up child rows itself, so a
-- task/event delete can never be blocked or leave orphans.
--
-- Safe to run repeatedly: it looks up whatever FK currently exists on each
-- column, drops it, and recreates it with ON DELETE CASCADE. Running it a second
-- time just re-applies the same cascade.
--
-- Apply with:  npm run db:migrate      (or paste this whole file into pgAdmin)

-- Session-local helper: drop any FK on (table, column) and recreate it CASCADE.
CREATE OR REPLACE FUNCTION pg_temp.recreate_fk_cascade(
  p_table    text,
  p_col      text,
  p_reftable text,
  p_refcol   text
) RETURNS void AS $$
DECLARE
  c text;
BEGIN
  -- Drop every existing foreign key that uses this column (there should be one).
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class      rel ON rel.oid = con.conrelid
    JOIN pg_namespace  ns  ON ns.oid  = rel.relnamespace
    JOIN pg_attribute  att ON att.attrelid = rel.oid AND att.attnum = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND ns.nspname  = 'public'
      AND rel.relname = p_table
      AND att.attname = p_col
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', p_table, c);
  END LOOP;

  -- Recreate it with ON DELETE CASCADE, using the conventional name.
  EXECUTE format(
    'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(%I) ON DELETE CASCADE',
    p_table, p_table || '_' || p_col || '_fkey', p_col, p_reftable, p_refcol
  );
END;
$$ LANGUAGE plpgsql;

-- Every FK that points at a task: deleting the task now removes these too.
SELECT pg_temp.recreate_fk_cascade('task_logs',         'task_id',         'tasks',  'task_id');
SELECT pg_temp.recreate_fk_cascade('task_assignments',  'task_id',         'tasks',  'task_id');
SELECT pg_temp.recreate_fk_cascade('task_dependencies', 'task_id',         'tasks',  'task_id');
SELECT pg_temp.recreate_fk_cascade('task_dependencies', 'depends_on_task', 'tasks',  'task_id');
SELECT pg_temp.recreate_fk_cascade('ai_task_map',       'task_id',         'tasks',  'task_id');
SELECT pg_temp.recreate_fk_cascade('notifications',     'task_id',         'tasks',  'task_id');

-- Deleting an event now removes its tasks (which in turn cascade to the rows above).
SELECT pg_temp.recreate_fk_cascade('tasks',             'event_id',        'events', 'event_id');
