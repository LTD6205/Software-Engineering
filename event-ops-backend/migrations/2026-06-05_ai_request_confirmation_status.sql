-- Migration: allow AI confirmation + clarification statuses on ai_requests.
--
-- Why: the Ask/confirm flow stores a pending plan (awaiting_confirmation) that a
-- later /confirm applies or /cancel discards; the clarification loop records a
-- needs_clarification turn. The original CHECK only allowed
--   status IN ('pending','success','rejected')
-- so those rows could not be written. This widens the CHECK. ('answered' reuses
-- 'success'.)
--
-- The column was VARCHAR(20); 'awaiting_confirmation' is 21 chars, so the
-- column is widened to VARCHAR(30) first (otherwise inserts fail with 22001).
--
-- Apply with:  npm run db:migrate   (or paste into pgAdmin)
-- Safe to run repeatedly: widening the type and recreating the CHECK are both idempotent.

ALTER TABLE ai_requests ALTER COLUMN status TYPE VARCHAR(30);

ALTER TABLE ai_requests DROP CONSTRAINT IF EXISTS ai_requests_status_check;

ALTER TABLE ai_requests
  ADD CONSTRAINT ai_requests_status_check
  CHECK (status IN (
    'pending', 'success', 'rejected',
    'awaiting_confirmation', 'cancelled', 'needs_clarification'
  ));
