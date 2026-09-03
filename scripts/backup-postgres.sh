#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
fi

: "${BACKUP_DIR:=backups}"
if [[ -n "${DATABASE_URL:-}" ]]; then
  : "${BACKUP_DATABASE_NAME:=sugar_factory}"
else
  : "${PGHOST:?PGHOST is required}"
  : "${PGPORT:=5432}"
  : "${PGUSER:?PGUSER is required}"
  : "${PGDATABASE:?PGDATABASE is required}"
  : "${BACKUP_DATABASE_NAME:=$PGDATABASE}"
fi

mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="$BACKUP_DIR/${BACKUP_DATABASE_NAME}_${timestamp}.dump"

if [[ -n "${DATABASE_URL:-}" ]]; then
  pg_dump \
    --dbname="$DATABASE_URL" \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-acl \
    --file="$output"
else
  pg_dump \
    --host="$PGHOST" \
    --port="$PGPORT" \
    --username="$PGUSER" \
    --dbname="$PGDATABASE" \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-acl \
    --file="$output"
fi

echo "Backup created: $output"