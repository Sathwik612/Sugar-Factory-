# PostgreSQL backups and restore

`scripts/backup-postgres.sh` creates a compressed custom-format dump with owner and ACL metadata removed. It uses standard `PG*` environment variables and never prints credentials.

```bash
PGPASSWORD=... BACKUP_DIR=/secure/backups ./scripts/backup-postgres.sh
```

Encrypt backups at rest, copy them off-host, restrict access, and define retention appropriate to factory policy. A practical pilot baseline is daily backups retained for 30 days plus monthly archives.

Restore is destructive because it cleans matching objects. Verify the target twice, stop application writes, and rehearse in a non-production database:

```bash
CONFIRM_RESTORE=YES RESTORE_DATABASE_URL=postgresql://.../sugar_factory_restore PGPASSWORD=... ./scripts/restore-postgres.sh /secure/backups/sugar_factory_YYYYMMDDTHHMMSSZ.dump
```

After restore, run readiness, record-count, authentication, approval-lock, and
audit-log checks. Record restore time, operator, backup identifier, and
validation outcome outside the database being restored.

## Object-storage backups

Database rows and uploaded workbooks must be backed up as one unit because
source-file lineage points from PostgreSQL to the stored object. With
`STORAGE_PROVIDER=s3`, enable private-bucket versioning and a lifecycle policy,
and replicate or copy objects to an encrypted backup bucket when the factory
policy requires it. With `STORAGE_PROVIDER=local`, include
`STORAGE_LOCAL_PATH` in the same daily backup schedule as PostgreSQL.

Rehearse both restores on an isolated database and storage prefix at least
monthly. The rehearsal is complete only after a source workbook can be
previewed, its lineage is visible, and a daily PDF can be generated from the
restored data.

When `DATABASE_URL` is configured, the backup helper uses it just like the
application. The restore helper refuses to use that URL implicitly; provide an
explicit `RESTORE_DATABASE_URL` for a disposable target so a rehearsal cannot
overwrite the application database by accident.