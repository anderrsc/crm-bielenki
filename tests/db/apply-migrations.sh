#!/usr/bin/env bash
# Aplica os stubs do Supabase + todas as migrations em ordem num banco vazio.
# Uso: DATABASE_URL=postgres://... tests/db/apply-migrations.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?defina DATABASE_URL}"
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f tests/db/supabase-stubs.sql
for f in $(ls supabase/migrations/*.sql | sort); do
  # pg_cron/pg_net so existem no Supabase.
  if ! grep -vE '^\s*create extension if not exists (pg_cron|pg_net)' "$f" \
      | psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -X >/dev/null 2>/tmp/migration-err.txt; then
    echo "FALHOU: $f"; cat /tmp/migration-err.txt; exit 1
  fi
  echo "ok  $f"
done
