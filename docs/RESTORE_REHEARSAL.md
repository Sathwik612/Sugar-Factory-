# Restore rehearsal record

**Date:** 2026-09-03 UTC  
**Environment:** isolated disposable PostgreSQL target on the application
database host  
**Scope:** compressed PostgreSQL dump, restore, core-record validation, and
cleanup

## Result

The rehearsal passed. A real dump was created using the same
`DATABASE_URL` precedence as the API, restored into a newly created temporary
database, validated, and removed after the check. The live application
database was not modified.

Validation returned:

| Check | Result |
|---|---:|
| Users | 6 |
| Production days | 35 |
| Source files | 5 |
| Audit logs | 92 |
| Lineage references | 3 |

The restored target was removed by the cleanup trap after validation.

## Storage validation

The local storage provider test also passed on 2026-09-03 UTC. It wrote a real
`.xlsx` workbook to an isolated temporary storage directory, read it back,
confirmed byte equality, and parsed one canonical row. Traversal and invalid
upload identifiers were rejected.

For a production S3 deployment, repeat the same check against a disposable
backup bucket or versioned prefix and record the object identifier alongside
the database backup identifier. The source-file lineage check is not complete
until a restored workbook can be previewed and its daily PDF can be generated.