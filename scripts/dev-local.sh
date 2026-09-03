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
: "${API_ORIGIN:=http://localhost:${API_PORT}}"

cleanup() {
  trap - EXIT INT TERM
  [[ -n "${api_pid:-}" ]] && kill "$api_pid" 2>/dev/null || true
  [[ -n "${web_pid:-}" ]] && kill "$web_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting API on http://localhost:${API_PORT}"
PORT="$API_PORT" pnpm --filter @workspace/api-server run dev &
api_pid=$!

echo "Starting dashboard on http://localhost:${WEB_PORT}"
PORT="$WEB_PORT" API_ORIGIN="$API_ORIGIN" BASE_PATH=/ pnpm --filter @workspace/sugar-factory-dashboard run dev &
web_pid=$!

wait -n "$api_pid" "$web_pid"
exit $?