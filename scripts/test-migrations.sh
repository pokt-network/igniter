#!/usr/bin/env bash
# Runs the middleman migration test (apps/middleman/src/db/migrations.test.ts) against a throwaway
# Postgres 16 in Docker. CI has no Postgres, so that test is skipped there; run this locally after
# adding or editing a middleman migration.
set -euo pipefail

PORT="${MIGRATION_TEST_PORT:-55432}"
NAME="igniter-migration-test-$$"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=pw -p "127.0.0.1:${PORT}:5432" postgres:16-alpine >/dev/null
trap 'docker stop "$NAME" >/dev/null' EXIT

for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 || { echo "Postgres did not become ready in 60s" >&2; exit 1; }

# The test only resets a database whose name contains "test"; it never creates or drops databases.
docker exec "$NAME" psql -U postgres -qc "CREATE DATABASE igniter_migrations_test"

DB_URL="postgres://postgres:pw@127.0.0.1:${PORT}/igniter_migrations_test"
cd "$ROOT/apps/middleman"
MIGRATION_TEST_DATABASE_URL="$DB_URL" npx jest src/db/migrations.test.ts

# The dispatcher's queue query (ordering + LIMIT) on the same migrated schema.
cd "$ROOT/apps/middleman-workflows"
MIGRATION_TEST_DATABASE_URL="$DB_URL" npx jest src/lib/dal/transaction.dispatch.pg.test.ts

# The failure-effects outbox (0022): every CAS on the outbox columns, the notify fence, the CHECKs.
MIGRATION_TEST_DATABASE_URL="$DB_URL" npx jest src/lib/dal/transaction.failureEffects.pg.test.ts
