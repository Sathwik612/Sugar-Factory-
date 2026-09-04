#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
./scripts/validate-production-env.sh
set -a
# shellcheck disable=SC1091
source ./.env
set +a

compose_args=(--env-file .env)
tools_args=(--env-file .env --profile tools)
if [[ "${ENABLE_HTTPS:-false}" == "true" ]]; then
  compose_args+=(--profile https)
fi
compose() { docker compose "${compose_args[@]}" "$@"; }
compose_tools() { docker compose "${tools_args[@]}" "$@"; }

compose build
compose up -d db
compose_tools run --rm db-migrate
if [[ -n "${BOOTSTRAP_ADMIN_PASSWORD:-}" && "${BOOTSTRAP_ADMIN_PASSWORD}" != replace-with-* ]]; then
  compose_tools run --rm admin-bootstrap
else
  echo "No bootstrap administrator was created. Set BOOTSTRAP_ADMIN_PASSWORD in .env for the first deployment."
fi
compose up -d

BASE_URL="${BASE_URL:-http://127.0.0.1:${WEB_PORT:-8080}}" \
SMOKE_USERNAME= SMOKE_PASSWORD= \
  ./scripts/vps-smoke.sh