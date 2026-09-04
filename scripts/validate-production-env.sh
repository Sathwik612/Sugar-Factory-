#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ -f .env ]] || { echo "Missing .env. Copy .env.production.example to .env first." >&2; exit 2; }

set -a
# shellcheck disable=SC1091
source ./.env
set +a

required=(NODE_ENV PGPASSWORD PGUSER PGDATABASE SESSION_SECRET CORS_ORIGIN COOKIE_SECURE TRUST_PROXY STORAGE_PROVIDER)
for key in "${required[@]}"; do
  [[ -n "${!key:-}" ]] || { echo "Missing required production setting: ${key}" >&2; exit 2; }
done

[[ "$NODE_ENV" == "production" ]] || { echo "NODE_ENV must be production." >&2; exit 2; }
[[ "$COOKIE_SECURE" == "true" ]] || { echo "COOKIE_SECURE must be true behind HTTPS." >&2; exit 2; }
[[ "${SEED_DEMO_DATA:-false}" != "true" ]] || { echo "SEED_DEMO_DATA must be false in production." >&2; exit 2; }
(( ${#SESSION_SECRET} >= 32 )) || { echo "SESSION_SECRET must be at least 32 characters." >&2; exit 2; }

IFS=',' read -ra origins <<< "$CORS_ORIGIN"
for origin in "${origins[@]}"; do
  [[ "$origin" == https://* ]] || { echo "Every CORS_ORIGIN must use HTTPS in production." >&2; exit 2; }
done

case "$STORAGE_PROVIDER" in
  s3)
    for key in S3_BUCKET S3_REGION S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
      [[ -n "${!key:-}" && "${!key}" != replace-with-* ]] || { echo "Missing S3 production setting: ${key}" >&2; exit 2; }
    done
    ;;
  local)
    [[ "${STORAGE_LOCAL_PATH:-}" == /* ]] || { echo "STORAGE_LOCAL_PATH must be an absolute path." >&2; exit 2; }
    ;;
  *)
    echo "STORAGE_PROVIDER must be s3 or local in production." >&2
    exit 2
    ;;
esac

if [[ "${ENABLE_HTTPS:-false}" == "true" ]]; then
  [[ -n "${DOMAIN:-}" && "$DOMAIN" != "sugar.example.com" ]] || { echo "Set DOMAIN to the real HTTPS hostname." >&2; exit 2; }
fi

node -e 'new Intl.DateTimeFormat("en", { timeZone: process.argv[1] }).format()' "${FACTORY_TIMEZONE:-Asia/Kolkata}" >/dev/null
echo "Production environment validation passed."