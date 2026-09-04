#!/bin/sh
set -eu

attempt=1
max_attempts="${DB_BOOTSTRAP_RETRIES:-30}"
while ! pnpm --filter @workspace/db run push; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Database schema setup failed after ${max_attempts} attempts." >&2
    exit 1
  fi
  echo "Database is not ready; retrying schema setup (${attempt}/${max_attempts})." >&2
  attempt=$((attempt + 1))
  sleep 2
done

if [ -n "${BOOTSTRAP_ADMIN_PASSWORD:-}" ] && [ "${BOOTSTRAP_ADMIN_PASSWORD}" != replace-with-* ]; then
  node /app/scripts/bootstrap-admin.mjs
fi

exec node --enable-source-maps /app/dist/index.mjs