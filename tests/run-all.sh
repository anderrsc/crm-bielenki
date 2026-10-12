#!/usr/bin/env bash
# Roda toda a bateria de testes do CRM a partir de um banco vazio:
#   1. aplica stubs do Supabase + todas as migrations num banco novo
#   2. sobe PostgREST + fake Supabase (auth/storage) e cria o admin de teste
#   3. popula dados de exemplo, faz o build do Next e sobe o app
#   4. verifica as consultas do codigo, testa o banco e roda os testes e2e
#
# Requer: Postgres acessivel como superusuario (PG_ADMIN_URL), Node com as
# dependencias instaladas e um Chrome/Chromium (CHROME_PATH, opcional).
#   PG_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)

PG_ADMIN_URL=${PG_ADMIN_URL:-postgres://postgres:postgres@localhost:5432/postgres}
TEST_DB=${TEST_DB:-crm_test}
export DATABASE_URL=$(node -e 'const u=new URL(process.argv[1]);u.pathname="/"+process.argv[2];console.log(u.toString())' "$PG_ADMIN_URL" "$TEST_DB")
AUTHENTICATOR_URL=$(node -e 'const u=new URL(process.argv[1]);u.username="authenticator";u.password="authenticator";console.log(u.toString())' "$DATABASE_URL")
export POSTGREST_URL=http://localhost:54330
export E2E_BASE_URL=${E2E_BASE_URL:-http://localhost:3000}
WORK=${TEST_WORK_DIR:-$ROOT/.test-work}
mkdir -p "$WORK"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

echo "==> banco $TEST_DB"
psql "$PG_ADMIN_URL" -q -c "drop database if exists $TEST_DB" -c "create database $TEST_DB"
tests/db/apply-migrations.sh > "$WORK/migrations.log" || { cat "$WORK/migrations.log"; exit 1; }
echo "    $(grep -c '^ok' "$WORK/migrations.log") migrations aplicadas"

echo "==> PostgREST"
POSTGREST_BIN=${POSTGREST_BIN:-$WORK/postgrest}
if [ ! -x "$POSTGREST_BIN" ]; then
  curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar xJ -C "$WORK"
  POSTGREST_BIN=$WORK/postgrest
fi
cat > "$WORK/postgrest.conf" <<EOF
db-uri = "$AUTHENTICATOR_URL"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "crm-bielenki-test-secret-com-pelo-menos-32-caracteres"
server-port = 54330
EOF
"$POSTGREST_BIN" "$WORK/postgrest.conf" > "$WORK/postgrest.log" 2>&1 & PIDS+=($!)
for i in $(seq 1 30); do curl -s -o /dev/null "$POSTGREST_URL" && break; sleep 1; done

echo "==> fake Supabase + admin de teste"
node tests/e2e/start-backend.mjs > "$WORK/backend.log" 2>&1 & PIDS+=($!)
for i in $(seq 1 30); do grep -q SERVICE_ROLE_KEY "$WORK/backend.log" 2>/dev/null && break; sleep 1; done
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
export NEXT_PUBLIC_SUPABASE_ANON_KEY=$(grep '^ANON_KEY=' "$WORK/backend.log" | cut -d= -f2)
export SUPABASE_SERVICE_ROLE_KEY=$(grep '^SERVICE_ROLE_KEY=' "$WORK/backend.log" | cut -d= -f2)
export SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
export NEXT_PUBLIC_SITE_URL=$E2E_BASE_URL
export ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
export EVOLUTION_WEBHOOK_SECRET=segredo-de-teste
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f tests/db/seed-sample.sql

echo "==> verificando consultas do codigo contra o banco"
node tests/static/check-queries.mjs

echo "==> testes do banco"
node --test --test-reporter=spec tests/db/db.test.mjs

echo "==> build e start do Next"
npx next build > "$WORK/build.log" 2>&1 || { tail -40 "$WORK/build.log"; exit 1; }
npx next start -p "${E2E_BASE_URL##*:}" > "$WORK/next.log" 2>&1 & PIDS+=($!)
for i in $(seq 1 60); do curl -s -o /dev/null "$E2E_BASE_URL/login" && break; sleep 1; done

echo "==> testes de ponta a ponta"
node --test --test-concurrency=1 --test-reporter=spec \
  tests/e2e/quote-flow.test.mjs tests/e2e/business.test.mjs tests/e2e/ui-actions.test.mjs \
  tests/e2e/remaining.test.mjs tests/e2e/forms.test.mjs tests/e2e/crawl.test.mjs
echo "==> tudo verde"
