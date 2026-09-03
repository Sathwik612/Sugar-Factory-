#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"

TEST_DATABASE="offline_approvals_$$"
API_PORT=$((42000 + ($$ % 1000) * 2))
WEB_PORT=$((API_PORT + 1))
API_PID=""
WEB_PID=""

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$WEB_PID" ]]; then kill "$WEB_PID" 2>/dev/null || true; fi
  if [[ -n "$API_PID" ]]; then kill "$API_PID" 2>/dev/null || true; fi
  wait "$WEB_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
  dropdb --if-exists --force --host "$PGHOST" --port "${PGPORT:-5432}" --username "$PGUSER" "$TEST_DATABASE" >/dev/null
  exit "$status"
}
trap cleanup EXIT INT TERM

createdb --host "$PGHOST" --port "${PGPORT:-5432}" --username "$PGUSER" "$TEST_DATABASE"
PGDATABASE="$TEST_DATABASE" pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run build

PGDATABASE="$TEST_DATABASE" PORT="$API_PORT" NODE_ENV=test SEED_DEMO_DATA=true \
  DISABLE_PUSH_DELIVERY_WORKER=true node artifacts/api-server/dist/index.mjs >test-api.log 2>&1 &
API_PID=$!

PORT="$WEB_PORT" NODE_ENV=test BASE_PATH=/ TEST_API_ORIGIN="http://127.0.0.1:$API_PORT" \
  pnpm --filter @workspace/sugar-factory-dashboard exec vite --host 127.0.0.1 >test-web.log 2>&1 &
WEB_PID=$!

for _ in {1..60}; do
  if curl --fail --silent "http://127.0.0.1:$API_PORT/api/readyz" >/dev/null &&
     curl --fail --silent "http://127.0.0.1:$WEB_PORT/" >/dev/null; then
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null || ! kill -0 "$WEB_PID" 2>/dev/null; then
    cat test-api.log test-web.log >&2
    exit 1
  fi
  sleep 0.5
done

curl --fail --silent "http://127.0.0.1:$API_PORT/api/readyz" >/dev/null
curl --fail --silent "http://127.0.0.1:$WEB_PORT/" >/dev/null

PGDATABASE="$TEST_DATABASE" TEST_API_URL="http://127.0.0.1:$API_PORT/api" pnpm run test:api
TEST_BASE_URL="http://127.0.0.1:$WEB_PORT" pnpm run test:browser