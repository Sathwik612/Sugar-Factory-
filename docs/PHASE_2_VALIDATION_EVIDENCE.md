# Phase 2 VPS Deployment Validation Evidence

Validation scope: Sugar Factory Intelligence Platform, Bilagi Sugar Mill Ltd., Season 2025–26.

This document records evidence available in the current workspace and the
Railway deployment configuration. It is not a substitute for a live Railway
project rehearsal with production PostgreSQL, storage, HTTPS, and alerting.

## Evidence completed in this workspace

| Area | Evidence |
| --- | --- |
| Static validation | Full workspace typecheck passes after the factory-local date/time changes. |
| Production build | Full workspace typecheck and production build pass after the factory-local date/time changes. |
| Dynamic reporting date | Dashboard and Operations Suite defaults resolve the current date using the configured factory timezone; explicit historical dates remain supported. |
| Timezone boundaries | Tests cover 23:59 IST, 00:01 IST, UTC midnight versus India midnight, differing UTC/India calendar dates, timestamp formatting, and invalid timezone rejection. |
| Reports | `current`/`latest` report aliases resolve through the factory timezone; PDF generated timestamps are formatted in that timezone. |
| Daily Operations | Missing production dates default server-side to the current factory-local date; submitted historical dates are preserved. |
| Storage and workbook handling | Existing local-storage round-trip, workbook parser, and source-path safety tests pass. |
| KPI and business logic | Existing KPI tests pass. |
| Database operations | Existing backup and isolated restore rehearsal evidence remains available in `docs/RESTORE_REHEARSAL.md`. |
| Local runtime smoke | API and web workflows restarted cleanly; authenticated API regression and browser offline/sync tests pass. |
| Container validation | API and web images build successfully with the migration/bootstrap tooling and optional HTTPS profile; compose configuration validates with production and tool profiles. |
| Railway configuration | `railway.toml` selects the API image, Railway healthcheck, and restart policy; the web image honors Railway's injected `PORT` and a private API upstream. See `RAILWAY_DEPLOYMENT.md`. |
| Railway image/runtime checks (2026-09-04 UTC) | API and web Docker builds passed. The web image served the dashboard on an injected test port and rendered a runtime-configured upstream; the API image reached its bounded database-migration retry guard with an unavailable test database. |
| Security | Existing dependency, SAST, and HoundDog findings remain documented in `docs/SECURITY_SCAN.md`. |

## Validation still required before a production decision

- Create the Railway project, Postgres service, API service, and web service from the reviewed branch.
- Validate Railway variables, database migrations, least-privilege credentials, backups, restore, and rollback in the target project.
- Validate the selected S3-compatible provider or Railway Volume, including permissions, retention, source-file upload, and restore behavior.
- Validate Railway custom DNS/HTTPS, forwarded headers, cookie security, CORS, upload limits, and deployment recovery.
- Exercise login, RBAC, Daily Operations approval/return/resubmission/locking, lineage, alerts, notifications, PDF, CSV, PWA reconnect/sync, and historical date selection through the deployed UI.
- Run authenticated concurrency tests that cover API writes, Excel imports, approval transitions, alerts, and notification polling rather than readiness requests only.
- Validate service restart/redeploy recovery, managed Postgres backup scheduling, restore rehearsal, and rollback using the actual Railway procedure. A host reboot is not available on Railway.
- Capture evidence from the target environment for mobile/PWA behavior, browser console cleanliness, and monitoring/alerting.

The remaining items are material external Railway-validation gaps rather than
implementation placeholders. No Railway project URL, service deployment, or
production credentials were available in this workspace, so the live
deployment and authenticated evidence could not be recorded here.

## Final verdict

RAILWAY PRODUCTION READY: NO — configuration is committed, live deployment validation remains.