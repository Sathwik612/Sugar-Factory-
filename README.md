# Sugar Factory Intelligence Platform

Sugar Factory Intelligence is a production-operations and management platform for:

> **Bilagi Sugar Mill Ltd. — Badagandi**
> **Season 2025–26**

It gives factory teams one place to enter Daily Operations data, review deterministic KPIs, manage approvals, track quality/stores/maintenance activity, investigate alerts, and trace management numbers back to their source.

> **Important:** The repository contains synthetic demonstration data and demo accounts. The demo data is not real factory data and must not be used to make operational, safety, financial, or compliance decisions.

---

## Contents

1. [What the platform does](#what-the-platform-does)
2. [Current product scope](#current-product-scope)
3. [Architecture](#architecture)
4. [Repository layout](#repository-layout)
5. [Requirements](#requirements)
6. [Quick local start](#quick-local-start)
7. [Local PostgreSQL setup](#local-postgresql-setup)
8. [Environment configuration](#environment-configuration)
9. [Running each service](#running-each-service)
10. [Production-like local hosting](#production-like-local-hosting)
11. [Docker Compose hosting](#docker-compose-hosting)
12. [Users, roles, and permissions](#users-roles-and-permissions)
13. [Daily Operations workflow](#daily-operations-workflow)
14. [KPI calculations](#kpi-calculations)
15. [Approvals and record locking](#approvals-and-record-locking)
16. [Notifications and web push](#notifications-and-web-push)
17. [Operational alerts](#operational-alerts)
18. [Offline and mobile behavior](#offline-and-mobile-behavior)
19. [Source registry and lineage](#source-registry-and-lineage)
20. [API routes](#api-routes)
21. [Database model](#database-model)
22. [Commands and verification](#commands-and-verification)
23. [Backups and restore](#backups-and-restore)
24. [Security and production configuration](#security-and-production-configuration)
25. [Troubleshooting](#troubleshooting)
26. [Known limitations and onboarding checklist](#known-limitations-and-onboarding-checklist)
27. [Git workflow](#git-workflow)

---

## What the platform does

The platform is designed around a single canonical Daily Operations record. The record can be:

- Entered manually by an authorized department operator
- Imported from a future Excel ingestion pipeline
- Reviewed and approved by management
- Used to calculate dashboard KPIs and operational alerts
- Traced through source, validation, approval, notification, and audit history

The core design principle is:

> **Source first, then trust the number.**

The system keeps operational values, calculated KPIs, alerts, approvals, source lineage, and audit events distinct so a manager can understand not only what a number is, but also where it came from and who changed it.

---

## Current product scope

### Management and analysis

- Management dashboard with current production KPIs
- KPI comparisons, trends, baselines, anomalies, and exceptions
- Daily management reports
- KPI drilldown and lineage views
- Downtime Pareto analysis
- Target-versus-actual planning
- Data-quality scorecard
- CSV export
- Deterministic application-generated PDF report download

### Daily operational entry

- Department-scoped Daily Operations form
- Production, quality, efficiency, time account, stoppage, energy, and materials sections
- Server-side validation
- Deterministic derived calculations
- Draft, submitted, under-review, returned, and approved states
- Return reasons
- Approved-record locking
- Pending-review locking
- Revision/concurrency checks
- Offline device drafts with explicit synchronization

### Operational modules

- Shift handover and action tracker
- Quality laboratory register
- Materials and stores movements
- Maintenance work orders
- Mobile operator mode
- Approval queue
- Notification center
- Factory and season settings
- Operational alerts and escalation
- Audit log
- User administration
- Source-file registry and validation history

### Platform hardening

- Local username/password authentication
- Scrypt password hashing
- PostgreSQL-backed sessions
- Server-side role authorization
- Secure, environment-aware cookies
- Trusted-origin CORS
- Security response headers
- Request-size limits
- Configurable in-memory rate limiting
- PostgreSQL readiness checks
- Graceful shutdown
- Bounded PostgreSQL connection pool
- PWA manifest and service worker
- Web-push subscription and delivery outbox
- Generic VPS Docker and reverse-proxy deployment
- S3-compatible or persistent local source-workbook storage
- Backup and restore scripts

---

## Architecture

The application is a TypeScript modular monolith:

```text
                         ┌─────────────────────────┐
                         │ React + Vite dashboard  │
                         │ PWA + IndexedDB drafts  │
                         └────────────┬────────────┘
                                      │
                                      │ /api
                                      │ session cookie
                                      ▼
                         ┌─────────────────────────┐
                         │ Express API server      │
                         │ auth + RBAC              │
                         │ canonical operations    │
                         │ approvals + alerts      │
                         │ notifications + audit   │
                         └────────────┬────────────┘
                                      │
                                      ▼
                         ┌─────────────────────────┐
                         │ PostgreSQL + Drizzle    │
                         │ users + sessions         │
                         │ factory + source data   │
                         │ operations + approvals  │
                         │ notifications + audit   │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │ Private source storage  │
                         │ S3-compatible or local  │
                         └─────────────────────────┘
```

The frontend is not a security boundary. Hiding a navigation item only improves usability. Every protected read and mutation is authorized again by the API.

### Request lifecycle

1. Browser sends a request to `/api`.
2. CORS, security headers, body limits, and rate limits are applied.
3. Session middleware resolves the PostgreSQL-backed session.
4. Route-level role and department authorization is applied.
5. Payload validation and business rules run on the server.
6. Database writes and audit events are committed.
7. Notifications and alert evaluation run using the canonical result.
8. The response returns a safe result or a request ID for troubleshooting.

### Generic VPS launch

The production deployment is a small Docker Compose stack behind host-level
HTTPS. PostgreSQL and the API are private; the web container serves the
dashboard and proxies `/api`. Source workbooks use a private S3-compatible
bucket or an explicitly persistent local directory. Start with:

```bash
cp .env.production.example .env
# fill the required values, including CORS_ORIGIN and storage credentials
docker compose build
docker compose up -d db
docker compose run --rm api pnpm --filter @workspace/db run push
docker compose up -d
curl -fsS http://127.0.0.1:8080/api/readyz
```

Read [VPS_DEPLOYMENT.md](./VPS_DEPLOYMENT.md) for HTTPS, firewall, storage,
backup, restore, and update procedures, then complete
[docs/VPS_READINESS_CHECKLIST.md](./docs/VPS_READINESS_CHECKLIST.md).

---

## Repository layout

```text
.
├── artifacts/
│   ├── api-server/
│   │   ├── src/
│   │   │   ├── index.ts                 API startup and shutdown
│   │   │   ├── app.ts                   Express middleware and route mounting
│   │   │   ├── routes/                  API route modules
│   │   │   ├── lib/                     auth, alerts, approvals, notifications
│   │   │   └── middlewares/             auth and rate limiting
│   │   └── package.json
│   ├── sugar-factory-dashboard/
│   │   ├── src/
│   │   │   ├── App.tsx                  shell, routes, dashboard, Daily Operations
│   │   │   ├── components/              reusable UI and notification center
│   │   │   ├── pages/                   Operations Suite
│   │   │   └── lib/offline-drafts.ts    IndexedDB draft storage
│   │   ├── public/
│   │   │   ├── manifest.webmanifest     PWA manifest
│   │   │   └── sw.js                    service worker
│   │   └── package.json
│   └── mockup-sandbox/                  design/component preview service
├── lib/
│   ├── db/
│   │   ├── src/schema/                  Drizzle schema source
│   │   └── drizzle.config.ts
│   ├── api-spec/                        OpenAPI source
│   ├── api-client-react/                generated React client
│   ├── api-zod/                         generated Zod schemas
│   └── replit-auth-web/                 frontend hook for the local auth API
├── scripts/
│   ├── dev-local.sh                     start API and dashboard together
│   ├── serve-local.sh                   serve built API and dashboard
│   ├── backup-postgres.sh
│   └── restore-postgres.sh
├── tests/
│   ├── api/                             authenticated API regression test
│   └── run-offline-approvals.sh         isolated test database runner
├── docker/
│   ├── api.Dockerfile
│   ├── web.Dockerfile
│   └── nginx.conf
├── compose.yaml
├── .env.example
├── DEPLOYMENT.md
├── BACKUPS.md
└── MOBILE.md
```

### Important source files

| Area | File |
|---|---|
| API startup | `artifacts/api-server/src/index.ts` |
| Express setup | `artifacts/api-server/src/app.ts` |
| Authentication | `artifacts/api-server/src/routes/auth.ts`, `src/lib/auth.ts` |
| Authorization | `artifacts/api-server/src/lib/authz.ts` |
| Daily Operations | `artifacts/api-server/src/routes/dailyOperations.ts` |
| Approvals | `artifacts/api-server/src/routes/approval.ts`, `src/lib/approvals.ts` |
| Notifications | `artifacts/api-server/src/routes/notifications.ts`, `src/lib/notifications.ts` |
| Alerts | `artifacts/api-server/src/lib/operationalAlerts.ts` |
| Audit | `artifacts/api-server/src/lib/audit.ts` |
| Database schema | `lib/db/src/schema/factory.ts`, `operations.ts`, `auth.ts` |
| Main frontend | `artifacts/sugar-factory-dashboard/src/App.tsx` |
| Operations Suite | `artifacts/sugar-factory-dashboard/src/pages/operations-suite.tsx` |
| Offline drafts | `artifacts/sugar-factory-dashboard/src/lib/offline-drafts.ts` |

---

## Requirements

### Required

- Node.js 24 or newer
- pnpm
- PostgreSQL
- Git

PostgreSQL 14 or newer is recommended for local development.

### Optional

- Docker and Docker Compose
- `createdb`, `dropdb`, `pg_dump`, and `pg_restore` PostgreSQL command-line tools
- A browser with IndexedDB, service-worker, and web-push support for mobile/PWA testing

The repository uses pnpm and intentionally rejects npm/yarn lockfile workflows. Use the committed `pnpm-lock.yaml`.

---

## Quick local start

### 1. Clone the repository

```bash
git clone https://github.com/Sathwik612/Sugar-Factory-.git
cd Sugar-Factory-
```

If you are working from the local-hosting branch:

```bash
git checkout local-hosting
```

### 2. Install dependencies

```bash
corepack enable
pnpm install
```

### 3. Create a local environment file

```bash
cp .env.example .env
```

Open `.env` and set at least:

```dotenv
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=your-local-postgres-password
PGDATABASE=sugar_factory
SESSION_SECRET=replace-with-a-long-random-local-value
```

Never commit `.env`.

### 4. Create the database

If your local PostgreSQL user can create databases:

```bash
createdb sugar_factory
```

If the database already exists, skip this command.

### 5. Apply the schema

```bash
pnpm run db:push:local
```

This loads the root `.env` before running Drizzle schema push.

### 6. Start the application

```bash
pnpm run dev:local
```

Open the dashboard:

```text
http://localhost:5173
```

The local dashboard proxies `/api` to:

```text
http://localhost:8080
```

No Replit domain, Replit login, or Replit-injected environment variable is required for this local path.

---

## Local PostgreSQL setup

### macOS with Homebrew

```bash
brew install postgresql@17
brew services start postgresql@17
createdb sugar_factory
```

Check the server:

```bash
pg_isready -h localhost -p 5432
```

### Ubuntu/Debian

Install PostgreSQL using the distribution’s supported package repository, then:

```bash
sudo -u postgres psql
```

Inside `psql`:

```sql
CREATE USER sugar_factory WITH PASSWORD 'choose-a-local-password';
CREATE DATABASE sugar_factory OWNER sugar_factory;
\q
```

Use these values in `.env`:

```dotenv
PGHOST=localhost
PGPORT=5432
PGUSER=sugar_factory
PGPASSWORD=choose-a-local-password
PGDATABASE=sugar_factory
```

### Windows

Install PostgreSQL using the official installer or a trusted package manager. Then create a database using pgAdmin or:

```powershell
createdb -U postgres sugar_factory
```

Set `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE` in `.env`.

### Using `DATABASE_URL`

Instead of individual `PG*` values, the database client accepts:

```dotenv
DATABASE_URL=postgresql://username:password@localhost:5432/sugar_factory
```

When `DATABASE_URL` is present, it takes precedence over the individual PostgreSQL variables.

---

## Environment configuration

`.env.example` is the complete local configuration template. The following values are supported.

### Database

| Variable | Purpose | Local example |
|---|---|---|
| `DATABASE_URL` | Full PostgreSQL connection string | `postgresql://postgres:password@localhost:5432/sugar_factory` |
| `PGHOST` | PostgreSQL hostname | `localhost` |
| `PGPORT` | PostgreSQL port | `5432` |
| `PGUSER` | PostgreSQL username | `postgres` |
| `PGPASSWORD` | PostgreSQL password | local-only value |
| `PGDATABASE` | Database name | `sugar_factory` |
| `PGPOOL_MAX` | Maximum pooled connections | `10` |
| `PG_IDLE_TIMEOUT_MS` | Idle connection timeout | `30000` |
| `PG_CONNECT_TIMEOUT_MS` | Connection timeout | `5000` |
| `PG_STATEMENT_TIMEOUT_MS` | PostgreSQL statement timeout | `30000` |

### Server

| Variable | Purpose | Default |
|---|---|---|
| `NODE_ENV` | `development`, `test`, or `production` | development in local script |
| `PORT` | API port; also used by standalone Vite commands | `8080` for API |
| `API_PORT` | API port used by `dev-local.sh` | value of `PORT`, then `8080` |
| `WEB_PORT` | Dashboard port used by local scripts | `5173` |
| `API_ORIGIN` | API target for local Vite proxy | `http://localhost:8080` |
| `BASE_PATH` | Dashboard base path | `/` |
| `TRUST_PROXY` | Trusted reverse-proxy hop count/name | empty locally |
| `LOG_LEVEL` | Pino log level | `info` |
| `JSON_BODY_LIMIT` | JSON request limit | `1mb` |
| `FORM_BODY_LIMIT` | URL-encoded request limit | `256kb` |
| `READINESS_TIMEOUT_MS` | Database readiness timeout | `3000` |
| `SHUTDOWN_TIMEOUT_MS` | Graceful shutdown deadline | `10000` |
| `SOURCE_FILE_MAX_BYTES` | Maximum workbook upload size | `10485760` |

### Source workbook storage

| Variable | Purpose | Local/VPS example |
|---|---|---|
| `STORAGE_PROVIDER` | `replit` for isolated development, or `s3`/`local` on a VPS | `s3` |
| `STORAGE_LOCAL_PATH` | Persistent directory for the local provider | `/var/lib/sugar-factory/uploads` |
| `S3_BUCKET` | Private S3-compatible bucket | `sugar-factory-source-files` |
| `S3_REGION` | S3 region | `ap-south-1` |
| `S3_ENDPOINT` | Optional endpoint for MinIO/other S3 services | empty for AWS |
| `S3_FORCE_PATH_STYLE` | Use path-style S3 requests when required | `false` |
| `S3_ACCESS_KEY_ID` | S3 access key | secret-managed value |
| `S3_SECRET_ACCESS_KEY` | S3 secret | secret-managed value |

Production startup requires an explicit `s3` or `local` provider. S3 uploads
use short-lived presigned URLs; local uploads use an authenticated, rate-limited
API endpoint and write to a persistent directory with generated object keys.
Uploaded objects are size-checked, signature-checked, hashed, and parsed before
they can enter the canonical model.

### Cookies and CORS

| Variable | Purpose | Local example |
|---|---|---|
| `COOKIE_SECURE` | Require HTTPS for the session cookie | `false` locally, `true` in HTTPS production |
| `COOKIE_SAME_SITE` | Cookie SameSite policy | `lax` |
| `COOKIE_DOMAIN` | Optional cookie domain | empty |
| `CORS_ORIGIN` | Comma-separated trusted browser origins | `http://localhost:5173` |

Same-origin requests do not require CORS. When a dashboard and API are on different origins, set `CORS_ORIGIN` explicitly.

### Rate limiting

| Variable | Purpose | Default |
|---|---|---|
| `RATE_LIMIT_WINDOW_MS` | General API rate-limit window | `60000` |
| `RATE_LIMIT_MAX` | General API requests per window/IP | `300` |
| `AUTH_RATE_LIMIT_WINDOW_MS` | Login rate-limit window | `900000` |
| `AUTH_RATE_LIMIT_MAX` | Login attempts per window/IP/username | `10` |

The limiter is intentionally in-memory and per process. For multiple API replicas, use a shared rate-limit store before horizontal scaling.

### Demo data

| Variable | Purpose |
|---|---|
| `SEED_DEMO_DATA` | Explicitly seed demo data when `true` |
| `DISABLE_PUSH_DELIVERY_WORKER` | Disable the web-push worker when `true` |

Development startup seeds demo users/data automatically because the API runs with `NODE_ENV=development`. Production startup does not seed unless `SEED_DEMO_DATA=true`.

### Web push

| Variable | Purpose |
|---|---|
| `WEB_PUSH_PUBLIC_KEY` | Browser-safe VAPID public key |
| `WEB_PUSH_PRIVATE_KEY` | Secret VAPID private key |
| `WEB_PUSH_SUBJECT` | VAPID contact subject, such as a `mailto:` URI |

Keep `WEB_PUSH_PRIVATE_KEY` and `WEB_PUSH_SUBJECT` in a secret manager or protected environment. Never commit them.

---

## Running each service

### Recommended: both local services

```bash
pnpm run dev:local
```

This runs:

```text
API       http://localhost:8080
Dashboard http://localhost:5173
```

The script stops both child processes when it exits.

### API only

```bash
pnpm --filter @workspace/api-server run dev
```

The API package loads `../../.env` when starting.

### Dashboard only

```bash
PORT=5173 API_ORIGIN=http://localhost:8080 BASE_PATH=/ \
  pnpm --filter @workspace/sugar-factory-dashboard run dev
```

Outside Replit, Vite automatically uses `http://localhost:8080` as the default API proxy target unless `API_ORIGIN` or `TEST_API_ORIGIN` is supplied.

### Mockup sandbox

The mockup sandbox is for component previews and is not required for normal application use:

```bash
pnpm --filter @workspace/mockup-sandbox run dev
```

---

## Production-like local hosting

Build all application artifacts:

```bash
pnpm run build:local
```

Start the built API and dashboard:

```bash
pnpm run start:local
```

Open:

```text
http://localhost:5173
```

Check API readiness:

```bash
curl -fsS http://localhost:8080/api/readyz
```

Expected response:

```json
{"status":"ready"}
```

`vite preview` is suitable for local verification, but it is not intended to be an internet-facing production web server. For a network-facing deployment, put the dashboard behind Nginx or another managed reverse proxy and terminate HTTPS there.

---

## Docker Compose hosting

Docker is optional and is not required for local development.

The repository includes:

- `docker/api.Dockerfile`
- `docker/web.Dockerfile`
- `docker/nginx.conf`
- `compose.yaml`

### Start the Compose stack

Create `.env` and set at least:

```dotenv
PGUSER=sugar_factory
PGPASSWORD=use-a-strong-password
PGDATABASE=sugar_factory
SESSION_SECRET=use-a-long-random-value
```

Then:

```bash
docker compose up --build
```

The web container is exposed on:

```text
http://localhost:8080
```

The API is reached through the Nginx `/api` proxy. The database is persisted in the `postgres_data` Docker volume.

### Compose notes

- The Compose database is separate from any PostgreSQL installed directly on the host.
- Apply the Drizzle schema from a controlled release environment before using the application.
- Do not expose PostgreSQL publicly.
- Set `COOKIE_SECURE=true` only when HTTPS is actually present.
- Replace the development/demo configuration before production use.
- Docker files are examples for a Docker-capable host; Replit workflows do not require Docker.

Detailed reverse-proxy and rollout guidance is in [`DEPLOYMENT.md`](./DEPLOYMENT.md).

---

## Users, roles, and permissions

All demo accounts are synthetic and use:

```text
Password: demo123
```

| Username | Role | Department | Main access |
|---|---|---|---|
| `production` | `PRODUCTION_OPERATOR` | Production | Production Daily Operations fields |
| `quality` | `QUALITY_OPERATOR` | Quality | Quality Daily Operations fields and Quality Lab |
| `engineering` | `ENGINEERING_OPERATOR` | Engineering | Efficiency, time, stoppages, energy, maintenance |
| `stores` | `STORES_OPERATOR` | Stores | Materials and Stores |
| `manager` | `MANAGER` | Management | Dashboard, reports, approvals, alerts, review |
| `admin` | `ADMIN` | Administration | Manager access plus users and factory settings |

### Permission rules

- Operators edit only their department-owned Daily Operations sections.
- Operators cannot edit pending-review records.
- Operators cannot edit approved records.
- Operators cannot approve their own submissions.
- Managers can review, return, approve, and acknowledge operational records/alerts.
- Administrators can manage users and factory configuration.
- API authorization is mandatory even when the frontend hides a control.
- Every important protected mutation creates an audit event.

---

## Daily Operations workflow

### Entry process

1. Log in with the appropriate department account.
2. Choose production date and shift.
3. Enter the sections owned by the current department.
4. Save a draft while collecting or reconciling information.
5. Submit when the record is ready for review.
6. The server validates and calculates derived KPIs.
7. The record becomes available to the assigned reviewer.

### Sections

- Production output
- Quality and cane profile
- Plant efficiency
- Available time and hours lost
- Power and steam balance
- Stoppage register
- Materials consumed

### Record states

```text
DRAFT
  ↓
SUBMITTED
  ↓
UNDER_REVIEW
  ├── APPROVED   locked
  └── RETURNED   correction required
                    ↓
                 SUBMITTED
```

The server remains authoritative for status transitions. A browser-side “submitted” label never means that the server accepted the submission.

---

## KPI calculations

Derived values are calculated on the server and should not be treated as client-owned values.

The canonical definitions and named calculation functions are maintained in
[`docs/KPI_DEFINITIONS.md`](./docs/KPI_DEFINITIONS.md). Independent expected-value
and edge-case coverage is recorded in
[`docs/CALCULATION_VALIDATION.md`](./docs/CALCULATION_VALIDATION.md).

### Recovery

```text
Recovery % = (Sugar Produced ÷ Cane Crushed) × 100
```

Recovery is only calculated when cane crushed is positive and the numeric inputs are valid.

### Hours lost

```text
Hours Lost = max(0, Available Hours − Hours Worked)
```

The server validates the time-account inputs and preserves the canonical calculation.

### Stoppage duration

```text
Stoppage Duration = End Time − Start Time
```

Durations are converted to hours and aggregated. Invalid ranges are rejected rather than silently treated as zero.

### Power exported

```text
Power Exported = max(0, Power Generated − Power Used)
```

### Power per tonne cane

```text
Power per Tonne Cane = Power Used ÷ Cane Crushed
```

This is calculated only when cane crushed is positive.

### Data-quality rule

Missing values are treated as unknown. Missing data does not automatically become healthy or zero.

---

## Approvals and record locking

Approval assignments are stored in PostgreSQL by factory and department. The default demo routing sends Production, Quality, Engineering, and Stores submissions to the Manager role.

A submission creates:

- An approval task
- Reviewer metadata
- A notification for the reviewer
- An audit event

Reviewers can:

- Start review
- Approve
- Return with a mandatory reason

Rules:

- The submitter cannot approve their own record.
- A returned record can be corrected and resubmitted.
- A pending-review record cannot be edited.
- An approved record cannot be edited.
- Return reasons are retained with the approval metadata and notification.
- Reviewer, decision, priority, timestamps, and return metadata are persisted.

---

## Notifications and web push

Notifications are durable PostgreSQL records, not browser-only state.

### In-app notifications

The notification center supports:

- Unread count
- Category counts
- Read-one
- Read-all
- Action links
- Polling and focus refresh
- Per-category preferences
- Approval, return, approval, alert, quality, stores, and maintenance events

### Supported notification categories

- Approvals required
- Data submitted
- Data returned
- Data approved
- Critical alerts
- Warning alerts
- Alert escalation
- Alert resolution
- Quality holds
- Stores reorder
- Maintenance priority
- Assigned/overdue actions

### Web-push delivery

The application supports an opt-in web-push flow:

1. Browser service worker is registered in production builds.
2. User opens notification settings.
3. User grants browser permission.
4. Browser subscription keys are sent to the API.
5. Subscription metadata is persisted and audited.
6. Critical notifications create delivery outbox attempts for opted-in recipients.
7. The API worker retries transient delivery failures.
8. Expired subscriptions are revoked.

The delivery worker requires all three values:

```dotenv
WEB_PUSH_PUBLIC_KEY=
WEB_PUSH_PRIVATE_KEY=
WEB_PUSH_SUBJECT=
```

Email, SMS, and WhatsApp delivery are intentionally not enabled.

---

## Operational alerts

Relevant writes trigger the deterministic alert evaluator:

- Daily Operations
- Quality samples
- Stores movements
- Maintenance work orders

The evaluator:

1. Reads the configured factory thresholds.
2. Compares a valid observation with its threshold.
3. Creates one active alert per factory/date/KPI combination.
4. Escalates warning conditions when appropriate.
5. Allows management acknowledgement.
6. Resolves the alert after a later valid observation.
7. Creates the appropriate notification.
8. Writes audit metadata for lifecycle changes.

Alert states:

```text
OPEN → ACKNOWLEDGED → RESOLVED
```

Alert severities:

```text
WARNING
CRITICAL
```

Repeated evaluation is deduplicated so refreshes do not create notification spam.

---

## Offline and mobile behavior

The dashboard is an installable PWA.

### What is cached

The service worker caches only the application shell and static assets:

- Root application shell
- Manifest
- Icons
- Static JavaScript, CSS, font, and image assets

It does **not** cache:

- `/api/*` responses
- Authenticated API responses
- Factory records
- Sensitive operational data

### Offline Daily Operations

When offline, the operator can save a device-local draft in IndexedDB. A local draft is keyed by:

- User
- Factory
- Production date
- Shift

Offline Save and offline Submit both remain local drafts. Offline Submit never creates a server `SUBMITTED` record.

### Synchronization

After reconnect:

1. The operator reviews the local draft.
2. The operator explicitly syncs it.
3. The client sends the last observed server revision.
4. If the server has changed, a conflict is shown.
5. The operator chooses local values or server values.
6. After a successful draft sync, the operator submits online.

Possible local states:

```text
LOCAL_ONLY
SYNC_PENDING
SYNCING
SYNCED
SYNC_FAILED
CONFLICT
```

The server is always authoritative for submission and approval.

See [`MOBILE.md`](./MOBILE.md) for the operating model and [`DEPLOYMENT.md`](./DEPLOYMENT.md) for hosting.

---

## Source registry and lineage

The source registry tracks source-file metadata and processing history, including:

- Filename
- Report type
- Reporting date
- Size
- SHA-256 hash
- Processing status
- Sheets
- Validation issues
- Processing events
- Lineage references

The current implementation provides registry and metadata views. Complete immutable workbook byte storage and production-grade workbook parsing are still onboarding work.

---

## API routes

All API routes are mounted under `/api`.

### Health

```text
GET  /api/healthz
GET  /api/readyz
```

`healthz` checks process liveness. `readyz` performs a non-sensitive PostgreSQL `select 1` check and returns HTTP `503` when the database is unavailable.

### Authentication

```text
GET  /api/auth/user
POST /api/login
POST /api/logout
```

Sessions use an HTTP-only `sid` cookie stored in PostgreSQL.

### Dashboard and reports

```text
GET /api/dashboard
GET /api/reports/daily/:productionDate
GET /api/reports/daily/:productionDate/lineage
```

Dashboard and reports require Manager or Admin access.

### Source registry

```text
GET  /api/source-files
GET  /api/source-files/:fileId
POST /api/source-files/upload
```

Source routes require Manager or Admin access.

### Daily Operations

```text
GET  /api/daily-operations/:productionDate
POST /api/daily-operations
```

The write endpoint validates department ownership, calculates derived values, evaluates alerts, and accepts an optional expected revision for conflict detection.

### Approvals

```text
GET  /api/approval-queue
GET  /api/approval-summary
POST /api/approval-queue/:recordId
```

Approval routes require Manager or Admin access.

### Operations Suite

```text
GET   /api/operations-suite?date=YYYY-MM-DD
POST  /api/operations-suite/handover
PATCH /api/operations-suite/actions/:id
POST  /api/operations-suite/quality
POST  /api/operations-suite/stores
POST  /api/operations-suite/maintenance
PATCH /api/operations-suite/maintenance/:id
POST  /api/operations-suite/targets
PATCH /api/operations-suite/settings
PATCH /api/operations-suite/alerts/:id/acknowledge
```

Department-specific backend authorization applies to each mutation.

### Notifications

```text
GET    /api/notifications
PATCH  /api/notifications/:id/read
POST   /api/notifications/read-all
GET    /api/notification-preferences
PATCH  /api/notification-preferences
GET    /api/push/config
GET    /api/push-subscriptions
POST   /api/push-subscriptions
DELETE /api/push-subscriptions/:id
```

### Users and audit

```text
GET  /api/users
POST /api/users
POST /api/users/:userId/reset-password
GET  /api/audit-logs
```

User management requires Admin access. Audit logs require Manager or Admin access.

---

## Database model

Schema source is under `lib/db/src/schema`.

### Authentication and audit

- `users`
- `sessions`
- `audit_logs`

### Factory and source data

- `factories`
- `production_days`
- `source_files`
- `kpi_values`
- `anomalies`
- `trend_points`
- `lineage_references`
- `processing_events`
- `validation_issues`
- `daily_operations`

### Operations Suite

- `factory_settings`
- `kpi_targets`
- `operational_actions`
- `quality_samples`
- `store_movements`
- `maintenance_work_orders`
- `operational_alerts`

### Approval and notification data

- `approval_assignments`
- `approval_tasks`
- `notifications`
- `notification_preferences`
- `push_subscriptions`
- `push_delivery_attempts`

The database is the source of truth for sessions, approvals, notifications, preferences, push delivery state, and auditability.

---

## Commands and verification

### Install

```bash
pnpm install
```

### Local database schema

```bash
pnpm run db:push:local
```

For an already-configured environment:

```bash
pnpm --filter @workspace/db run push
```

### Typecheck

```bash
pnpm run typecheck
```

### Full build

```bash
pnpm run build
```

### Local build

```bash
pnpm run build:local
```

### Development

```bash
pnpm run dev:local
```

### Built local serving

```bash
pnpm run start:local
```

### Isolated offline/approval regression workflow

This test creates a temporary PostgreSQL database, applies the schema, starts isolated API and dashboard processes, runs authenticated API/browser checks, and drops the temporary database during cleanup.

Load local variables first:

```bash
set -a
source ./.env
set +a
pnpm run test:offline-approvals
```

The test checks:

- Readiness failure behavior
- Login
- Approval protection
- Self-approval rejection
- Approved-record locking
- Push subscription creation and revocation
- Login rate limiting
- Browser-level offline/approval checks

### OpenAPI code generation

The OpenAPI contract is under `lib/api-spec/openapi.yaml`. When it changes:

```bash
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck
```

Do not hand-edit generated API client/Zod files unless the generation workflow explicitly requires it.

### Replit workflows

The repository retains these managed workflows:

- `artifacts/api-server: API Server`
- `artifacts/sugar-factory-dashboard: web`
- `artifacts/mockup-sandbox: Component Preview Server`
- `offline-approvals`

Local hosting does not depend on those workflows.

---

## Backups and restore

Create a compressed PostgreSQL backup:

```bash
./scripts/backup-postgres.sh
```

The script reads `.env` when present and writes protected files under `backups/` by default.

Restore is destructive and requires an explicit confirmation:

```bash
CONFIRM_RESTORE=YES ./scripts/restore-postgres.sh backups/sugar_factory_YYYYMMDDTHHMMSSZ.dump
```

Before restoring:

1. Confirm the target database.
2. Stop application writes.
3. Verify the backup file.
4. Rehearse on a non-production database.
5. Record the operator, time, backup identifier, and validation result.
6. Run readiness and authentication checks after restore.

See [`BACKUPS.md`](./BACKUPS.md) for retention, encryption, and restore guidance.

---

## Security and production configuration

### Secrets

Never commit:

- `.env`
- Database passwords
- `DATABASE_URL` values containing credentials
- `SESSION_SECRET`
- `WEB_PUSH_PRIVATE_KEY`
- Browser cookies
- API tokens
- Provider credentials

Use a secret manager or protected deployment environment.

### Cookies

Cookies are:

- HTTP-only
- Environment-aware for `secure`
- Configurable for SameSite
- Configurable for domain
- Path-scoped

For HTTPS production:

```dotenv
NODE_ENV=production
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
```

### CORS

Use an explicit list of trusted origins:

```dotenv
CORS_ORIGIN=https://factory.example.com
```

Do not use arbitrary credentialed-origin reflection in production.

### Reverse proxy

When behind one trusted proxy:

```dotenv
TRUST_PROXY=1
```

Forward `Host`, `X-Forwarded-Proto`, and `X-Forwarded-For`. Terminate TLS at the managed proxy or load balancer and redirect HTTP to HTTPS there.

### Security headers

The API sets:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy`
- `Cross-Origin-Opener-Policy`

### Rate limiting

Login and API requests are rate-limited. The built-in limiter is per process. Deployments with multiple replicas should use a shared store before scaling out.

### Database safety

- Pool size is bounded.
- Connection, idle, and statement timeouts are configurable.
- Readiness does not expose database credentials or error details.
- Shutdown drains HTTP connections and closes the PostgreSQL pool.
- Schema changes should be applied as a controlled release step.

### Security scan status

The repository has been reviewed with dependency, static-analysis, and dataflow scanners. Dependency findings should be reviewed and upgraded as part of release maintenance; development-tool transitive packages may still appear in scanner output even though they are not part of the production API runtime.

---

## Troubleshooting

### `Database configuration is missing`

Confirm that `.env` exists and contains either:

```dotenv
DATABASE_URL=...
```

or all required values:

```dotenv
PGHOST=...
PGUSER=...
PGPASSWORD=...
PGDATABASE=...
```

Then retry:

```bash
pnpm run db:push:local
```

### `password authentication failed`

Check that `PGUSER`, `PGPASSWORD`, `PGHOST`, and `PGPORT` match the PostgreSQL server you are actually running. If both `DATABASE_URL` and `PG*` values exist, `DATABASE_URL` wins.

### Port already in use

Choose other local ports:

```bash
API_PORT=18080 WEB_PORT=18517 pnpm run dev:local
```

If `CORS_ORIGIN` is set, update it to match the dashboard origin when the API and dashboard are hosted on different origins.

### Dashboard loads but API calls fail

Confirm:

```bash
curl -i http://localhost:8080/api/healthz
curl -i http://localhost:8080/api/readyz
```

Then confirm the dashboard was started with:

```bash
API_ORIGIN=http://localhost:8080
```

### API starts but immediately exits

Check:

- PostgreSQL is running
- Database credentials are valid
- Schema has been applied
- `PORT` is a valid positive number
- `SESSION_SECRET` and other environment values are not malformed

### Demo users are missing

Demo users seed during development startup. Confirm the API is running with `NODE_ENV=development` and that it can write to the configured database.

For a production-style run, set:

```dotenv
SEED_DEMO_DATA=true
```

only in a deliberately configured demo environment.

### Web push is unavailable

Check:

- The browser supports service workers and Push API.
- The page is served from HTTPS, or from localhost during local testing.
- All three VAPID values are configured.
- The browser permission was granted.
- The subscription is visible through the notification settings flow.

### Local drafts do not appear

IndexedDB is browser-profile and origin specific. A draft saved on `localhost:5173` will not automatically appear on another port, hostname, browser, or private window.

### A record is locked

This is usually expected:

- `UNDER_REVIEW` records cannot be edited.
- `APPROVED` records are permanently locked by the normal operator flow.
- A returned record must be corrected and resubmitted.

### A new alert does not appear

Check:

1. The factory threshold configuration exists.
2. The observed value is numeric.
3. The value is not missing.
4. The relevant write route invokes the evaluator.
5. An active alert does not already exist for the same factory/date/KPI.
6. The audit log contains the alert lifecycle event.

---

## Known limitations and onboarding checklist

### Current limitations

- Workbook ingestion currently supports a controlled Daily Operations table layout; factory-specific mapping templates and broader departmental workbook shapes still require pilot validation.
- Export currently provides CSV and fixed-layout server-generated daily PDF; native styled XLSX export is not yet included.
- Demo accounts are for demonstration only and must be replaced or disabled for production identity onboarding.
- Web push is implemented as an opt-in/outbox/delivery-worker capability; provider/VAPID operations must be managed securely.
- Email, SMS, and WhatsApp are disabled.
- In-memory rate limiting is not sufficient for multi-replica deployment.
- Production thresholds, reviewer assignments, retention, backup, and correction policies require factory-management sign-off.
- Real factory data must be reconciled and validated before operational use.

### Before real factory use

1. Confirm the factory identity and season.
2. Replace demo users with approved identities.
3. Set strong passwords and a controlled reset process.
4. Set `NODE_ENV=production`.
5. Set `COOKIE_SECURE=true` behind HTTPS.
6. Set explicit `CORS_ORIGIN`.
7. Configure `TRUST_PROXY` correctly.
8. Disable demo seeding.
9. Configure reviewer assignments.
10. Configure and approve alert thresholds.
11. Establish backup, retention, and restore-rehearsal policy.
12. Validate readiness, authentication, approval locking, and audit events.
13. Test representative `.xlsx` and `.xls` source workbooks with the factory data owner.
14. Reconcile imported records with factory source documents using [`docs/DATA_VALIDATION.md`](./docs/DATA_VALIDATION.md).
15. Perform and record a 25–30-user concurrency test.
16. Perform and record a backup restore rehearsal.
17. Train operators on offline drafts and conflict handling.
18. Decide whether web-push delivery is approved for managers.
19. Monitor rate-limit events, readiness failures, delivery failures, and unexpected errors.

### Phase 1 productionization status

Completed in the current codebase:

- Central KPI formulas, named functions, definitions, edge-case tests, and validation guidance
- Protected App Storage upload flow with actual-byte SHA-256 hashing
- Workbook sheet inspection, preview, mapping, validation, duplicate detection, canonical Daily Operations draft import, and cell-level lineage
- Import conflict protection and concurrent import claim state
- Application-generated daily management PDF download

Still required before the real 25–30-user pilot:

- Factory-specific workbook mapping/UAT and management sign-off
- A repeatable concurrency run with recorded results
- A completed restore rehearsal with recorded results
- Security scan and full end-to-end regression run against the pilot configuration

Detailed rollout guidance is in [`DEPLOYMENT.md`](./DEPLOYMENT.md).

---

## Git workflow

Create a feature branch:

```bash
git checkout -b feature/short-description
```

Before committing:

```bash
git status
git diff
pnpm run typecheck
pnpm run build
```

Stage only reviewed files:

```bash
git add README.md
git commit -m "docs: expand local hosting and platform guide"
git push -u origin feature/short-description
```

The original repository’s default branch should not be changed unintentionally. When maintaining a separate delivery branch, verify:

```bash
git branch --show-current
git remote -v
git status
```

Do not push secrets, `node_modules`, build output, local uploads, screenshots, or local environment files.

---

## Knowledge-transfer walkthrough

For a 20–30 minute walkthrough:

1. Log in as `manager`.
2. Review the dashboard KPIs and exception cards.
3. Open Daily Operations.
4. Log in as each operator role and show department scoping.
5. Save a draft, submit it, and open the approval queue.
6. Return the record with a reason.
7. Resubmit and approve it from an eligible reviewer account.
8. Confirm that approved records are locked.
9. Open Operations Suite.
10. Demonstrate Quality Lab, Stores, Maintenance, and Handover.
11. Review targets, alerts, Pareto, lineage, and data-quality views.
12. Open Notification Center and preferences.
13. Explain offline draft behavior and conflict resolution.
14. Log in as `admin` and review user/factory settings.
15. Finish with the known limitations and production onboarding checklist.

---

## Related documentation

- [`KT_HANDOVER.md`](./KT_HANDOVER.md) — deeper product and codebase handover
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — deployment, proxy, rollout, and environment guidance
- [`BACKUPS.md`](./BACKUPS.md) — PostgreSQL backup, retention, and restore
- [`MOBILE.md`](./MOBILE.md) — PWA, IndexedDB, synchronization, and push behavior