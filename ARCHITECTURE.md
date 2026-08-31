# Sugar Factory Intelligence Platform — Architecture

## 1. Purpose

The platform turns existing sugar-mill Excel workbooks into a traceable daily management report:

```text
Raw workbook
  → immutable file registry
  → workbook inspection
  → configurable mapping
  → validation
  → canonical records
  → deterministic KPIs
  → historical baselines
  → rule-based anomalies
  → reproducible report
  → dashboard and audit trail
```

The first release is a modular monolith. It optimizes for correctness, inspectability, and a small operational deployment rather than premature service decomposition.

## 2. Proposed stack

| Area | Decision | Rationale |
|---|---|---|
| Web UI | Next.js, TypeScript, Tailwind CSS | Responsive management dashboard with typed API client |
| API | FastAPI, Pydantic, SQLAlchemy | Python is strong for Excel/data processing and provides explicit contracts |
| Database | PostgreSQL | Tenant-safe relational data, reporting queries, migration support |
| Background jobs | Celery + Redis | Daily ingestion/report jobs without coupling request latency to processing |
| Workbook processing | pandas + openpyxl; optional xlrd for legacy `.xls` | Handles real workbook variation while preserving source coordinates |
| Object storage | S3-compatible adapter; local filesystem for development | Original files are immutable and never exposed through credentials |
| Auth | Secure session/JWT boundary with backend RBAC | Tenant isolation and server-enforced permissions |
| Reports | HTML first, PDF-ready rendering behind an adapter | Reproducible output before adding delivery concerns |
| Testing | pytest, API/integration tests, frontend checks | Acceptance path is an Excel-to-report pipeline |

The implementation begins with a single repository and a single deployable application boundary. Worker execution and storage are replaceable adapters, not separate products.

## 3. Runtime boundaries

### API application

Owns authentication, authorization, upload intake, file metadata, inspection results, report/dashboard reads, configuration, and audit events. It never performs unbounded workbook processing inline.

### Processing services

Pure or mostly pure modules:

- `ingestion`: hashing, safe filenames, workbook inspection, report-type detection
- `mapping`: aliases, explicit mappings, normalization, unit conversion
- `validation`: typed issues and completeness decisions
- `kpi`: deterministic calculations and lineage inputs
- `anomaly`: configurable comparison rules
- `reports`: report model and renderers

### Persistence

PostgreSQL stores tenant-scoped metadata, canonical/derived values, lineage, configuration, and audit events. Original workbooks live behind an object-storage adapter; local development uses a private storage directory.

## 4. Core data flow

1. An authorized user uploads an `.xlsx` or supported `.xls`.
2. The API streams the file to temporary storage, enforces size/type limits, computes SHA-256, and creates a registry record.
3. An exact hash match for the same factory is marked `DUPLICATE`; the original record remains untouched.
4. A worker inspects workbook sheets and headers, records a workbook manifest, and detects candidate report types.
5. A versioned mapping configuration maps source cells/columns to canonical fields. Ambiguous mappings become reviewable warnings, never silent data.
6. Validation produces `ERROR`, `WARNING`, or `INFO` issues with source coordinates.
7. Valid canonical records are persisted with source lineage and are eligible for KPI calculation.
8. KPI calculations create versioned values plus formula and input lineage.
9. Baselines are calculated only from available historical records; the denominator/sample count is explicit.
10. Rules create anomaly records with actual, baseline, deviation, rule, and evidence.
11. A reproducible daily report snapshot is rendered from persisted results and is available to the dashboard.

## 5. Tenant isolation and authorization

Every business table carries an organization/factory scope either directly or through a required parent. API queries require the authenticated principal's factory scope; service-layer authorization is authoritative even if the UI hides controls.

Initial role capabilities:

- `SUPER_ADMIN`: platform-wide administration
- `FACTORY_ADMIN`: factory configuration, users, mappings, thresholds, uploads
- `PLANT_HEAD`: operational dashboard, reports, raw files, acknowledgements
- `MANAGER`: dashboard, reports, source traceability
- `ANALYST`: data quality, mappings/read access, analysis
- `VIEWER`: read-only dashboard/report access

Permission checks are named capabilities, not scattered role comparisons.

## 6. Observability and failure handling

Each processing run has a correlation ID and ordered lifecycle events: received, hashed, parsing, mapping, validating, KPI calculation, report generation, completed/failed. User-facing failures explain what to fix; logs retain technical context. A failed file remains available for inspection and retry; raw bytes are not overwritten.

## 7. Explicit non-goals for Phase 1

- No LLM-generated numerical calculations
- No predictive models
- No autonomous control or IoT ingestion
- No unnecessary microservices
- No vector indexing of every workbook
- No fabricated baselines or missing values

## 8. Replacement seams

Storage, task queue, authentication token/session implementation, report renderer, and workbook parser are adapter boundaries. The domain services depend on interfaces and versioned records, so deployment infrastructure can change without changing KPI semantics.

## 9. Initial repository layout

```text
/backend/app/{api,core,models,schemas,services,ingestion,kpi,anomaly,reports,auth,audit}
/backend/tests
/frontend/{app,components,lib,types}
/docs
/scripts
/docker
```

The first implementation slice will establish the repository contract, configuration, health endpoint, database migration baseline, and a test harness before adding business workflows.