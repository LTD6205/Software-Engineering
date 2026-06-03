-- Rename the 'eventmanager' role to 'organizer'.
--
-- Why: 'eventmanager' contains the substring 'manager', which made it easy to
-- mismatch against the 'manager' role in code/queries; 'organizer' is a single
-- distinct word. (The event_managers table — the managers who belong to an
-- event — is a different concept and is intentionally left unchanged.)
--
-- Idempotent: safe to re-run (db-migrate applies every file each time).

-- 1) Drop the role CHECK, migrate existing rows, then re-add it with the new set.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role = 'organizer' WHERE role = 'eventmanager';
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('manager', 'staff', 'admin', 'organizer'));

-- 2) Realign the seeded demo accounts (email + display name) with the new role
--    name, so re-running seed.js (which upserts ON CONFLICT (email)) updates the
--    same rows instead of creating duplicate organizer01@… accounts.
UPDATE users SET email = replace(email, 'eventmanager', 'organizer')
  WHERE email LIKE 'eventmanager%@eventops.com';
UPDATE users SET name = replace(name, 'Event Manager', 'Organizer')
  WHERE name LIKE 'Event Manager %';
