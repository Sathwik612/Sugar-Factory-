#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:=5432}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${1:?Usage: CONFIRM_RESTORE=YES scripts/restore-postgres.sh path/to/backup.dump}"

if [[ "${CONFIRM_RESTORE:-}" != "YES" ]]; then
  echo "Restore cancelled. Set CONFIRM_RESTORE=YES after verifying the target database and backup." >&2
  exit 2
fi

backup_file="$1"
[[ -r "$backup_file" ]] || { echo "Backup is not readable: $backup_file" >&2; exit 2; }

pg_restore \
  --host="$PGHOST" \
  --port="$PGPORT" \
  --username="$PGUSER" \
  --dbname="$PGDATABASE" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --exit-on-error \
  "$backup_file"

echo "Restore completed for database: $PGDATABASE"