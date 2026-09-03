#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.example to .env and set PostgreSQL values first." >&2
  exit 2
fi

set -a
# shellcheck disable=SC1091
source ./.env
set +a

: "${API_PORT:=${PORT:-8080}}"
: "${WEB_PORT:=5173}"

if [[ ! -f artifacts/api-server/dist/index.mjs || ! -d artifacts/sugar-factory-dashboard/dist/public ]]; then
  echo "Production artifacts are missing. Run pnpm run build:local first." >&2
  exit 2
fi

cleanup() {
  trap - EXIT INT TERM
  [[ -n "${api_pid:-}" ]] && kill "$api_pid" 2>/dev/null || true
  [[ -n "${web_pid:-}" ]] && kill "$web_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

PORT="$API_PORT" NODE_ENV=production pnpm --filter @workspace/api-server run start &
api_pid=$!
PORT="$WEB_PORT" pnpm --filter @workspace/sugar-factory-dashboard run serve &
web_pid=$!

echo "API:       http://localhost:${API_PORT}/api/readyz"
echo "Dashboard: http://localhost:${WEB_PORT}"
wait -n "$api_pid" "$web_pid"
exit $?