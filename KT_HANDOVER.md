# Sugar Factory Intelligence — Knowledge Transfer

**Last updated:** 02 September 2026  
**Factory:** Bilagi Sugar Mill Ltd. — Badagandi  
**Season:** 2025–26  
**Environment:** Replit pnpm monorepo with PostgreSQL, Express, Drizzle, React, and Vite

## 1. What this product does

Sugar Factory Intelligence converts sugar-mill daily operating information into a reliable management view. The system is designed around one canonical daily operations record, whether data arrives from:

- Manual departmental entry
- Future Excel workbook ingestion
- Existing synthetic demonstration records

The important product principle is **source first, then trust the number**. Production KPIs, validation results, exceptions, lineage, approvals, and audit events are kept separate so a manager can understand where a number came from and who changed it.

The current demo is synthetic and clearly labeled. It is not production factory data.

## 2. Current status

### Delivered

- Daily management dashboard with production KPIs, comparisons, trends, exceptions, and status
- Daily Operations entry using one canonical model
- Deterministic server-side KPI calculations
- Excel/source registry and processing metadata
- Report view with cell-level lineage references
- Local username/password authentication
- Six role types with server-side permission enforcement
- Manager review, approval, return, and locking workflow
- Admin user creation and password reset
- Audit-log recording and viewing
- Operations Suite with:
  - Shift handover and action tracker
  - Quality laboratory register
  - Materials and stores movements
  - Equipment maintenance work orders
  - KPI targets and target-versus-actual view
  - Factory and season configuration
  - Alerts and escalation rules
  - Downtime Pareto
  - KPI drilldown and lineage explorer
  - Data-quality scorecard
  - Responsive mobile operator layout
  - CSV export and browser print/save-as-PDF
- Automatic alert evaluation after daily operation, quality, stores, and maintenance writes
- Alert deduplication, escalation, acknowledgement, resolution, and audit events

### Still pending

- Native styled XLSX generation
- Server-generated, fixed-layout PDF management packs
- Real workbook byte storage and ingestion/parsing
- Production deployment data migration and production data validation
- Automated browser regression coverage for the alert lifecycle and all new operator forms

## 3. How the system is structured

This is intentionally a **modular monolith**, not a group of microservices.

```text
React/Vite dashboard
        |
        |  /api requests with session cookie
        v
Express API server
        |
        +-- auth and role middleware
        +-- daily operations routes
        +-- dashboard/report/source routes
        +-- approval, users, and audit routes
        +-- Operations Suite routes
        +-- deterministic alert evaluator
        v
PostgreSQL through Drizzle ORM
```

The database and API are shared by the dashboard and are intended to remain the stable seam for future Excel ingestion and additional clients.

## 4. Repository map

### Product applications

- `artifacts/sugar-factory-dashboard`
  - React/Vite frontend
  - Main shell, navigation, route guards, login screen, dashboard, Daily Operations, reports, approvals, audit log, users, and settings
  - `src/pages/operations-suite.tsx` contains the new integrated operations workspace
- `artifacts/api-server`
  - Express API
  - Authentication, authorization, canonical daily records, approvals, audit logs, source registry, and Operations Suite APIs
- `artifacts/mockup-sandbox`
  - Component preview server used for design work; it is not part of the core production request path

### Shared libraries

- `lib/db/src/schema`
  - PostgreSQL/Drizzle schema source
- `lib/api-spec/openapi.yaml`
  - OpenAPI source of truth for the original generated API surface
- `lib/api-client-react/src/generated`
  - Generated React API hooks/client
- `lib/api-zod/src/generated`
  - Generated Zod request/response schemas
- `lib/replit-auth-web/src/use-auth.ts`
  - Frontend session and current-user handling

### Important API files

- `artifacts/api-server/src/index.ts`
  - Server startup and seed sequence
- `artifacts/api-server/src/routes/auth.ts`
  - Local login, logout, current user, and demo-user seeding
- `artifacts/api-server/src/lib/auth.ts`
  - Session handling, scrypt password hashing, password verification, and auth-user mapping
- `artifacts/api-server/src/lib/authz.ts`
  - Role definitions and section permissions
- `artifacts/api-server/src/lib/audit.ts`
  - Audit event helper
- `artifacts/api-server/src/routes/dailyOperations.ts`
  - Daily Operations read/write flow, department scoping, validation, KPI calculations, status changes, and alert evaluation
- `artifacts/api-server/src/routes/operationsSuite.ts`
  - Handover, quality, stores, maintenance, target, settings, alert acknowledgement, and aggregated Operations Suite read APIs
- `artifacts/api-server/src/lib/operationalAlerts.ts`
  - Central alert rules, threshold matching, deduplication, escalation, acknowledgement-safe updates, resolution, and audit metadata
- `artifacts/api-server/src/lib/demoData.ts`
  - Demo factory, synthetic history, synthetic operations records, and startup seed data

## 5. User roles and demo accounts

All demo accounts use the same demo password:

```text
demo123
```

| Username | Role | Department | Main capability |
|---|---|---|---|
| `production` | `PRODUCTION_OPERATOR` | Production | Production section of Daily Operations and shared Operations Suite |
| `quality` | `QUALITY_OPERATOR` | Quality | Quality section and laboratory samples |
| `engineering` | `ENGINEERING_OPERATOR` | Engineering | Engineering, stoppages, maintenance, and downtime |
| `stores` | `STORES_OPERATOR` | Stores | Materials and stores movements |
| `manager` | `MANAGER` | Management | Dashboard, reports, approvals, alerts, targets, and review |
| `admin` | `ADMIN` | Administration | Manager capabilities plus users and factory configuration |

Passwords are stored as scrypt hashes. They are not stored as plaintext.

Important security rule: frontend hiding is only a convenience. The API also checks the role for every protected operation.

## 6. Main user journeys

### Login

1. Open the dashboard.
2. Use one of the demo usernames above.
3. Enter `demo123`.
4. The API creates a local session and sets the secure `sid` cookie.
5. Navigation and direct routes are filtered by role.

### Daily Operations

1. Choose the production date and shift.
2. Enter only the sections owned by the current department.
3. The server preserves sections the operator is not allowed to edit.
4. The server validates the payload and calculates derived values.
5. Save as `DRAFT` or submit as `SUBMITTED`.
6. Managers can start review, return the record, or approve it.
7. Approved records cannot be edited by operators.

### Operations Suite

Open `/operations-suite` after login. The page is divided into focused workspaces:

- **Control room:** targets, actuals, active alerts, and summary cards
- **Handover:** shift notes and actions that can be completed
- **Quality lab:** Brix, Pol, Purity, disposition, and notes
- **Stores:** receipt, issue, adjustment, quantity, unit, and reorder level
- **Maintenance:** asset, issue, work type, priority, hours lost, assignee, and status
- **Analysis & export:** downtime Pareto, data-quality scorecard, KPI drilldown, lineage, CSV export, and print-to-PDF
- **Configuration:** KPI targets for managers and factory/season/shift settings for admins

The layout collapses into a stacked operator-friendly view on smaller screens.

### Alert lifecycle

Alerts are evaluated after relevant data is written:

1. A daily operations record is saved/submitted.
2. A quality sample is recorded.
3. A stores movement is recorded.
4. A maintenance order is created or updated.
5. The central evaluator reads the factory threshold configuration.
6. The evaluator creates one active alert per factory/date/KPI combination.
7. A warning can escalate to critical.
8. Managers/admins can acknowledge the alert.
9. A later valid observation can resolve it.
10. Raising, escalating, acknowledging, and resolving are audit logged.

Missing values are treated as unknown, not automatically healthy.

## 7. Deterministic KPI calculations

The server, not the browser, is the source of truth for derived values.

Current calculations include:

- **Recovery:** sugar produced divided by cane crushed, multiplied by 100
- **Hours Lost:** validated from the time-account value when supplied
- **Stoppage duration:** end time minus start time, converted to hours
- **Total stoppage hours:** sum of validated stoppage durations
- **Power Exported:** maximum of zero and power generated minus power used
- **Power per tonne cane:** power used divided by cane crushed when cane crushed is positive
- **Steam consumption:** retained/normalized from the submitted energy section

Invalid stoppage ranges are rejected. For example, a stoppage ending before it starts does not get silently accepted.

## 8. Database model

The existing factory and canonical data tables remain the foundation. The new operational tables are in `lib/db/src/schema/operations.ts`:

- `factory_settings`
  - Season, shift names, threshold rules, and default targets
- `kpi_targets`
  - Factory/date/shift/KPI target values
- `operational_actions`
  - Handover notes and action tracker items
- `quality_samples`
  - Laboratory sample readings and dispositions
- `store_movements`
  - Material receipts, issues, adjustments, units, and reorder levels
- `maintenance_work_orders`
  - Assets, issues, priority, status, assignee, and hours lost
- `operational_alerts`
  - Alert state, severity, observed value, threshold, direction, source entity, acknowledgement, and resolution metadata

Operational demo records have `is_demo = true`. Automatically raised alerts have `is_demo = false`, because they represent system-generated behavior from an observation even when the underlying demo record is synthetic.

## 9. Important status values

### Daily Operations

```text
DRAFT
SUBMITTED
UNDER_REVIEW
APPROVED
```

### Handover/actions and maintenance

```text
OPEN
IN_PROGRESS
DONE
```

### Alerts

```text
OPEN
ACKNOWLEDGED
RESOLVED
```

### Alert severities

```text
WARNING
CRITICAL
```

## 10. Useful routes

### Frontend routes

- `/`
  - Latest management dashboard
- `/daily-operations`
  - Department-scoped canonical entry
- `/operations-suite`
  - Integrated operations workspace
- `/reports/:productionDate`
  - Management report and lineage
- `/files`
  - Source registry
- `/files/:fileId`
  - Source file detail and validation history
- `/approval-queue`
  - Manager/admin approval center with queue metrics, filters, priority, and mandatory return reasons
- `/audit-log`
  - Audit events
- `/users`
  - Admin user management
- `/settings`
  - Existing readiness/settings surface

### Operations Suite API routes

All routes are mounted under `/api`.

- `GET /operations-suite?date=YYYY-MM-DD`
- `POST /operations-suite/handover`
- `PATCH /operations-suite/actions/:id`
- `POST /operations-suite/quality`
- `POST /operations-suite/stores`
- `POST /operations-suite/maintenance`
- `PATCH /operations-suite/maintenance/:id`
- `POST /operations-suite/targets`
- `PATCH /operations-suite/settings`
- `PATCH /operations-suite/alerts/:id/acknowledge`

### Approval and notification API routes

- `GET /approval-queue`
- `GET /approval-summary`
- `POST /approval-queue/:recordId`
- `GET /notifications`
- `PATCH /notifications/:id/read`
- `POST /notifications/read-all`
- `GET /notification-preferences`
- `PATCH /notification-preferences`

Approval assignments, approval tasks, notification preferences, and notification records are persisted in PostgreSQL. Notification delivery is currently in-app; external email/SMS/WhatsApp providers are intentionally disabled.

The Operations Suite page currently calls these endpoints with `fetch`. If these APIs are added to the formal OpenAPI contract later, regenerate the React client and Zod schemas afterward.

## 11. Running the project

Use pnpm; the repository blocks npm/yarn lockfile workflows.

```bash
pnpm install
```

Run the API:

```bash
pnpm --filter @workspace/api-server run dev
```

Run the dashboard:

```bash
pnpm --filter @workspace/sugar-factory-dashboard run dev
```

The configured Replit workflows already run:

- API Server
- Sugar Factory dashboard
- Mockup sandbox component preview server

The managed workflows provide the runtime port and base path.

## 12. Database and generated-code commands

Push Drizzle schema changes to the development database only:

```bash
pnpm --filter @workspace/db run push
```

Run the full typecheck:

```bash
pnpm run typecheck
```

Build all packages:

```bash
pnpm run build
```

Regenerate generated clients/schemas after an OpenAPI change:

```bash
pnpm --filter @workspace/api-spec run codegen
```

Do not delete the platform-managed `PG*` variables. The database connection supports the platform PostgreSQL variables as a fallback.

## 13. Verification already completed

The following checks have passed:

- All six demo users authenticate successfully.
- Invalid credentials return `401`.
- Operators cannot access management/admin-only modules.
- Managers can access dashboard, approvals, alerts, and audit logs.
- Admins can manage users and factory configuration.
- Department-scoped field preservation works.
- Draft → submitted → under review → approved workflow works.
- Returned records require a reason and notify the submitter.
- Resubmission creates a fresh reviewer notification without duplicating the prior event.
- Operators cannot edit pending or approved records.
- Submitters cannot approve their own records.
- Persistent unread/read notification state and preference updates work.
- Critical alert raise and later resolution both create management notifications.
- Full workspace typecheck passes.
- Repository-wide production build passes.
- API and dashboard workflows start cleanly.
- Operations Suite aggregation returned seeded targets, handovers, samples, stores, maintenance, alerts, KPIs, and Pareto data.
- Production operator access to the suite works.
- Production operator quality-write access is correctly rejected with `403`.
- Alert lifecycle logic was merged and is present in `operationalAlerts.ts`.

## 14. Known limitations and next work

### Report files

The current export buttons provide:

- Excel-compatible CSV
- Browser print/save-as-PDF

They do not yet create a native styled `.xlsx` or server-generated PDF file. That is the next report-export slice.

### Workbook ingestion

Source registration and metadata processing exist, but the current source intake does not yet persist immutable workbook bytes or run complete workbook parsing. Real factory onboarding should add object storage, file hashing, parser versioning, validation results, and import reconciliation.

### Additional regression automation

Targeted authenticated API checks cover submission, assignment, return reasons, resubmission, approval, locking, notification persistence, and critical alert resolution. A dedicated automated CI suite should additionally cover:

- Repeated breach deduplication
- Warning-to-critical escalation
- Acknowledged alert updates
- Resolution after recovery
- Quality HOLD alerts
- Stores reorder alerts
- Maintenance priority alerts

### Production readiness

Before using real factory data:

1. Replace or disable demo seeding for the target environment.
2. Confirm factory identity and season configuration.
3. Confirm role assignments and password reset process.
4. Configure alert thresholds with management.
5. Add real source-file storage and ingestion.
6. Test approval and audit retention expectations.
7. Validate production deployment and database schema separately from development.
8. Configure a supported external notification provider only if management approves email/SMS/WhatsApp delivery and its cost.

## 15. Practical troubleshooting

### Dashboard is blank

1. Confirm the API workflow is running.
2. Refresh workflow logs.
3. Check `/api/healthz`.
4. Confirm the dashboard is using the managed artifact base path.
5. Restart the API and dashboard workflows once after code or command changes.

### User cannot write a section

This is usually expected role scoping. Confirm the logged-in department and role. Managers/admins can perform broader operational writes, but backend permission checks remain authoritative.

### Alert did not appear

Check:

1. The relevant `factory_settings.kpiThresholds` entry exists.
2. The submitted value is numeric and not missing.
3. The write route calls the corresponding evaluator.
4. The record has a valid factory and production date.
5. An existing active alert was not already present for the same factory/date/KPI.
6. The API audit log contains either `RAISED_OPERATIONAL_ALERT`, `ESCALATED_OPERATIONAL_ALERT`, or a resolution event.

## 16. Suggested KT walkthrough

For a 20–30 minute handover:

1. Log in as `manager`.
2. Open the dashboard and explain the six KPI cards.
3. Open `/daily-operations` and show department-scoped entry.
4. Save a draft, submit it, and show the approval queue.
5. Open `/operations-suite`.
6. Review target-versus-actual, active alerts, and the data-quality score.
7. Open the Quality Lab, Stores, and Maintenance tabs.
8. Open Analysis & Export and demonstrate Pareto, lineage, CSV, and print.
9. Log in as `quality` and show that only quality writes are enabled.
10. Return to `manager`, acknowledge an alert, and show the audit event.
11. Log in as `admin` and show user/configuration administration.
12. Finish with the limitations in Section 14 before discussing production onboarding.
