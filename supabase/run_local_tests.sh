#!/usr/bin/env bash
# Applies every migration to a throwaway Postgres database and runs the RPC
# test suite against it. Validates the schema, the RLS policies and the
# server-side business logic without touching a real Supabase project.
#
#   PGHOST=/var/run/postgresql ./supabase/run_local_tests.sh
set -euo pipefail

DB="${TEST_DB:-sufra_test}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "→ recreating database $DB"
psql -tAc "drop database if exists $DB;" >/dev/null
psql -tAc "create database $DB;" >/dev/null

for f in _test_shim.sql \
         migrations/0001_schema.sql \
         migrations/0002_rls.sql \
         migrations/0003_functions.sql \
         migrations/0004_seed.sql; do
  echo "→ applying $f"
  psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$HERE/$f" 2>&1 \
    | grep -vE "NOTICE:.*(does not exist, skipping|already exists)" || true
done

echo "→ running RPC tests"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$HERE/_test_rpcs.sql" 2>&1 \
  | sed 's/^psql:[^ ]* //'

echo "→ running RLS tests"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$HERE/_test_rls.sql" 2>&1 \
  | sed 's/^psql:[^ ]* //'
