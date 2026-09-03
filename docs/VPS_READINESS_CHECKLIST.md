# VPS readiness checklist

Complete this checklist on the target VPS and attach the evidence to the
deployment record.

## Configuration and access

- [ ] `NODE_ENV=production`.
- [ ] `SESSION_SECRET` is unique, long, and stored outside source control.
- [ ] `PGPASSWORD`, S3 credentials, and web-push private keys are not in logs,
      shell history, images, or the repository.
- [ ] `STORAGE_PROVIDER` is `s3` or `local`; no production Replit storage
      variables or sidecar dependency are required.
- [ ] `CORS_ORIGIN` exactly matches the HTTPS application origin.
- [ ] `COOKIE_SECURE=true` and the reverse-proxy hop configuration is correct.
- [ ] `SEED_DEMO_DATA=false`.
- [ ] The public firewall exposes only 80/443 (and SSH with restricted access).
- [ ] PostgreSQL and the API are not directly internet-facing.

## Runtime and security

- [ ] `docker compose config` succeeds with the production environment file.
- [ ] `docker compose build` succeeds from a clean checkout.
- [ ] API and web containers run as expected; the API healthcheck is green.
- [ ] `/api/healthz` and `/api/readyz` return expected responses through HTTPS.
- [ ] Security headers are present and HTTPS redirects are enforced at the host.
- [ ] Login rate limiting, API rate limiting, body limits, and strict CORS were
      checked in a staging-like environment.
- [ ] Non-manager accounts cannot upload, import, or administer source files.
- [ ] Approved Daily Operations records remain locked.

## Data path

- [ ] A valid `.xlsx` workbook uploads, is registered, parsed, and validated.
- [ ] An invalid extension, oversized body, duplicate row, bad signature, and
      impossible production value are rejected.
- [ ] The workbook hash, parser version, mapping, validation issues, and
      processing events are persisted.
- [ ] Imported canonical values appear in KPIs and the source lineage view.
- [ ] The deterministic daily PDF downloads and contains the expected KPI values.
- [ ] A duplicate workbook does not create a second canonical import.
- [ ] S3/local objects are private and inaccessible through guessed paths.

## Backup and recovery

- [ ] A database backup completed and was copied off-host.
- [ ] Object-storage backup/versioning or local upload-directory backup is
      enabled.
- [ ] A restore rehearsal was completed on an isolated target.
- [ ] Restored authentication, approval locking, audit history, source preview,
      lineage, and PDF generation were checked.
- [ ] Restore duration and Recovery Point/Time Objectives were recorded.
- [ ] Retention and deletion policies were approved by the factory owner.

## Load and handover

- [ ] A 25–30-user concurrency smoke test completed without elevated 5xx rates,
      pool exhaustion, or unacceptable p95 latency.
- [ ] Graceful shutdown was tested while requests were active.
- [ ] Monitoring and alert recipients were assigned.
- [ ] Operators received the login, source-file, Daily Operations, approval,
      backup, and incident procedures.