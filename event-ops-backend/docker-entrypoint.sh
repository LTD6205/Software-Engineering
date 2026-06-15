#!/bin/sh
# Backend container start-up.
#
# The canonical schema (database_creating.txt) is applied once by Postgres
# itself on first boot (see docker-compose.prod.yml's initdb mount). Here we
# apply the ordered, idempotent migrations on top — retrying until the database
# is actually reachable AND the base schema exists, so start-up order between
# the db and backend containers never matters.
set -e

echo "[entrypoint] applying database migrations (waiting for the DB to be ready)..."
until node db-migrate.js; do
  echo "[entrypoint] DB not ready / schema not applied yet — retrying in 3s"
  sleep 3
done

echo "[entrypoint] migrations applied — starting backend on :3000"
exec node dist/main
