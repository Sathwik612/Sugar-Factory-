# PostgreSQL backups and restore

`scripts/backup-postgres.sh` creates a compressed custom-format dump with owner and ACL metadata removed. It uses standard `PG*` environment variables and never prints credentials.

```bash
PGPASSWORD=... BACKUP_DIR=/secure/backups ./scripts/backup-postgres.sh
```

Encrypt backups at rest, copy them off-host, restrict access, and define retention appropriate to factory policy. A practical pilot baseline is daily backups retained for 30 days plus monthly archives.

Restore is destructive because it cleans matching objects. Verify the target twice, stop application writes, and rehearse in a non-production database:

```bash
CONFIRM_RESTORE=YES PGPASSWORD=... ./scripts/restore-postgres.sh /secure/backups/sugar_factory_YYYYMMDDTHHMMSSZ.dump
```

After restore, run readiness, record-count, authentication, approval-lock, and audit-log checks. Record restore time, operator, backup identifier, and validation outcome outside the database being restored.