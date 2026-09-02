# Sugar Factory Intelligence

Sugar Factory Intelligence turns sugar-mill daily operations and Excel/source records into a traceable management view for Bilagi Sugar Mill Ltd. — Badagandi. It combines department-scoped entry, deterministic KPI calculations, approval controls, operational alerts, persistent notifications, reports, and source lineage in one application.

> The included demonstration data and accounts are synthetic. They must not be interpreted as production factory records.

## Product capabilities

- Daily management dashboard and reports
- Production, quality, engineering, energy, stoppage, and stores data
- Department-scoped Daily Operations entry
- Deterministic recovery, hours-lost, stoppage, and power calculations
- Source-file registry, validation history, and cell-level lineage
- Role-based access control and local sessions
- Approval assignment, review, return, resubmission, approval, and record locking
- Persistent PostgreSQL notification center with unread counts and preferences
- Automatic notifications for approvals, returns, approvals, and operational alert changes
- Automatic operational alert raising, deduplication, escalation, acknowledgement, and resolution
- Quality laboratory, materials, maintenance, handover, target, and configuration modules
- Downtime Pareto, KPI drilldown, and data-quality scorecard
- Responsive operator UI
- Installable PWA with device-local Daily Operations drafts and explicit conflict resolution
- Health/readiness probes, graceful shutdown, bounded PostgreSQL pooling, rate limits, and trusted-origin CORS
- CSV and browser print/PDF export

See [`KT_HANDOVER.md`](./KT_HANDOVER.md) for a detailed product and codebase walkthrough.
Production runbooks: [`DEPLOYMENT.md`](./DEPLOYMENT.md), [`BACKUPS.md`](./BACKUPS.md), and [`MOBILE.md`](./MOBILE.md).

## Architecture

The application is a TypeScript modular monolith:

```text
React + Vite dashboard
        |
        | HTTPS /api + secure session cookie
        v
Express API
        |
        +-- authentication and RBAC
        +-- canonical Daily Operations
        +-- approvals and notifications
        +-- deterministic alert evaluator
        +-- reports, sources, lineage, and audit
        v
PostgreSQL + Drizzle ORM
```

Business-critical authorization, calculation, approval, alert, and notification behavior runs on the server. React visibility rules are not treated as security.

## Repository structure

```text
artifacts/
  api-server/                 Express API
  sugar-factory-dashboard/    React/Vite web app
  mockup-sandbox/             Design preview artifact
lib/
  db/                         Drizzle schema and PostgreSQL client
  api-spec/                   OpenAPI contract
  api-client-react/           Generated React API client
  api-zod/                    Generated Zod schemas
  replit-auth-web/            Frontend session hook
scripts/                      Workspace support scripts
```

Important server modules:

- `artifacts/api-server/src/routes/dailyOperations.ts`
- `artifacts/api-server/src/routes/approval.ts`
- `artifacts/api-server/src/routes/notifications.ts`
- `artifacts/api-server/src/lib/approvals.ts`
- `artifacts/api-server/src/lib/notifications.ts`
- `artifacts/api-server/src/lib/operationalAlerts.ts`
- `lib/db/src/schema/factory.ts`
- `lib/db/src/schema/operations.ts`

## Requirements

- Node.js 24
- pnpm
- PostgreSQL

The workspace intentionally rejects npm/yarn installs to keep one lockfile.

## Local setup

1. Clone the repository.
2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Copy the environment example:

   ```bash
   cp .env.example .env
   ```

4. Replace only the local placeholder values in `.env`. Never commit the file.
5. Apply the development schema:

   ```bash
   pnpm --filter @workspace/db run push
   ```

6. Start the API:

   ```bash
   pnpm --filter @workspace/api-server run dev
   ```

7. In a second terminal, start the dashboard:

   ```bash
   pnpm --filter @workspace/sugar-factory-dashboard run dev
   ```

Replit users can use the preconfigured API Server and dashboard workflows instead.

## Environment variables

The application accepts:

- `DATABASE_URL` — PostgreSQL connection string
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` — fallback PostgreSQL settings
- `SESSION_SECRET` — environment-owned session secret
- `PORT` — service port
- `BASE_PATH` — dashboard artifact path
- `LOG_LEVEL` — optional API logging level

Only placeholder values belong in `.env.example`. Real database credentials, session secrets, API keys, and platform-managed values must remain in the environment/secret manager.

## Demo users

All included accounts are explicitly synthetic:

| Username | Role |
|---|---|
| `production` | Production operator |
| `quality` | Quality operator |
| `engineering` | Engineering operator |
| `stores` | Stores operator |
| `manager` | Manager |
| `admin` | Administrator |

Demo password: `demo123`

Passwords are stored as scrypt hashes, never plaintext.

## Role structure

- Operators edit only their assigned department sections.
- Managers review assigned operational submissions, view management reports, and acknowledge alerts.
- Administrators manage users, factory configuration, and full management access.
- The API rejects cross-department writes, unauthorized approvals, self-approval, and direct edits to approved records.

## Approval workflow

```text
DRAFT
  -> SUBMITTED
  -> reviewer notification + approval task
  -> UNDER_REVIEW
  -> APPROVED (locked)
     or
  -> RETURNED (reason required)
  -> operator correction
  -> SUBMITTED again
```

Department-to-reviewer-role assignments are stored in PostgreSQL. The default demo mapping sends Production, Quality, Engineering, and Stores submissions to the Manager role.

## Notification workflow

Notifications are durable PostgreSQL records, not browser-only state.

- The shell polls periodically and refreshes after user actions.
- The bell shows a real unread count.
- Users can mark one or all notifications as read.
- Action links open the relevant approval, Daily Operations, or alert view.
- User preferences control approval, data-decision, quality, stores, maintenance, and operational alert messages.
- In-app delivery is enabled.
- Opted-in managers receive critical alerts through audited web-push delivery when production VAPID secrets are configured.
- Email, SMS, and WhatsApp are intentionally not connected to paid providers.
- Deterministic deduplication keys prevent refresh/re-evaluation spam.

## Operational alert workflow

Operational writes run the existing deterministic evaluator:

```text
observation -> threshold lookup -> OPEN
            -> possible WARNING-to-CRITICAL escalation
            -> ACKNOWLEDGED
            -> RESOLVED after a later valid observation
```

Alert events create appropriate management notifications. Critical alerts notify Manager and Admin roles. Alert lifecycle actions and notification creation are audit logged.

## Checks and builds

Full typecheck:

```bash
pnpm run typecheck
```

Full build:

```bash
pnpm run build
```

Dashboard production build:

```bash
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/sugar-factory-dashboard run build
```

After any OpenAPI change:

```bash
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck
```

## Database development

Drizzle schema definitions live under `lib/db/src/schema`.

For the Replit development database:

```bash
pnpm --filter @workspace/db run push
```

Production schema changes use the Replit Publish schema-diff flow. Do not add startup-time DDL or custom production migration scripts.

## GitHub development workflow

Recommended feature workflow:

```bash
git checkout -b feature/short-description
pnpm install
pnpm run typecheck
pnpm run build
git status
git add <reviewed-files>
git commit -m "feat: describe the change"
git push -u origin feature/short-description
```

Before committing:

- Review `git diff`.
- Confirm `.env` and credentials are not tracked.
- Do not commit `node_modules`, `dist`, coverage, uploaded source files, screenshots, or local Replit agent state.
- Regenerate and commit generated API clients only when the OpenAPI contract changes.
- Keep synthetic seed data clearly labeled.

## Production-readiness limitations

- Source intake currently focuses on registry/metadata; immutable workbook storage and full real-workbook ingestion remain future work.
- CSV and browser print/PDF are available; native styled XLSX and server-generated PDF packs remain future work.
- Demo user seeding must be disabled or separated before production identity onboarding.
- Notification delivery is currently in-app only.
- Production thresholds, reviewer assignments, retention, backup, and correction policies require factory-management sign-off.
- Real factory data must be reconciled and validated before operational use.

## Security notes

- Never commit database URLs, PostgreSQL passwords, session secrets, provider credentials, cookies, or API keys.
- Approved records are locked against direct updates.
- Return reasons are mandatory.
- A submitter cannot approve their own submission.
- Every protected mutation has server-side authorization.
- Audit metadata must never include passwords or secrets.