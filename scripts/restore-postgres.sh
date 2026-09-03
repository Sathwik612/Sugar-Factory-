#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
fi

: "${1:?Usage: CONFIRM_RESTORE=YES scripts/restore-postgres.sh path/to/backup.dump}"

if [[ "${CONFIRM_RESTORE:-}" != "YES" ]]; then
  echo "Restore cancelled. Set CONFIRM_RESTORE=YES after verifying the target database and backup." >&2
  exit 2
fi

backup_file="$1"
[[ -r "$backup_file" ]] || { echo "Backup is not readable: $backup_file" >&2; exit 2; }

if [[ -n "${DATABASE_URL:-}" && -z "${RESTORE_DATABASE_URL:-}" ]]; then
  echo "RESTORE_DATABASE_URL is required when DATABASE_URL is configured; this prevents an accidental production restore." >&2
  exit 2
fi

if [[ -n "${RESTORE_DATABASE_URL:-}" ]]; then
  pg_restore \
    --dbname="$RESTORE_DATABASE_URL" \
    --clean \
    --if-exists \
    --no-owner \
    --no-acl \
    --exit-on-error \
    "$backup_file"
  echo "Restore completed for the explicitly supplied target database URL."
  exit 0
fi

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:=5432}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${RESTORE_DATABASE:=$PGDATABASE}"
pg_restore \
  --host="$PGHOST" \
  --port="$PGPORT" \
  --username="$PGUSER" \
  --dbname="$RESTORE_DATABASE" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --exit-on-error \
  "$backup_file"

echo "Restore completed for database: $RESTORE_DATABASE"