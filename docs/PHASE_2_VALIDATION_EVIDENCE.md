# Phase 2 VPS Deployment Validation Evidence

Validation scope: Sugar Factory Intelligence Platform, Bilagi Sugar Mill Ltd., Season 2025–26.

This document records evidence available in the current workspace. It is not a substitute for a rehearsal on the target Linux/VPS environment with the intended PostgreSQL, storage, reverse-proxy, and operational controls.

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
| Container validation | Existing API and web image build, compose validation, health/readiness, and restart evidence remains documented; container images were not rebuilt as part of this date/time-only validation pass. |
| Security | Existing dependency, SAST, and HoundDog findings remain documented in `docs/SECURITY_SCAN.md`. |

## Validation still required before a production decision

- Run the complete validation matrix on a clean Linux/VPS-like host without Replit services.
- Validate the chosen production PostgreSQL instance, migrations, least-privilege credentials, backups, restore, and rollback on the target host.
- Validate the selected S3-compatible provider or persistent local storage, including permissions, retention, source-file upload, and restore behavior.
- Validate Nginx or Caddy, real DNS, HTTPS certificates, forwarded headers, cookie security, CORS, upload limits, and renewal behavior.
- Exercise login, RBAC, Daily Operations approval/return/resubmission/locking, lineage, alerts, notifications, PDF, CSV, PWA reconnect/sync, and historical date selection through the deployed UI.
- Run authenticated concurrency tests that cover API writes, Excel imports, approval transitions, alerts, and notification polling rather than readiness requests only.
- Validate restart and host reboot recovery, backup scheduling, restore rehearsal, and rollback using the actual deployment procedure.
- Capture evidence from the target environment for mobile/PWA behavior, browser console cleanliness, and monitoring/alerting.

The remaining items are material production-validation gaps rather than implementation placeholders. The workspace evidence is therefore insufficient for a positive VPS deployment decision.

## Final verdict

VPS PRODUCTION READY: NO