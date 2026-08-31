# Sugar Factory Intelligence Platform — Roadmap

## Delivery rule

Each step follows:

```text
PLAN → IMPLEMENT → TEST → REVIEW → FIX → DOCUMENT
```

No later step is considered complete when the preceding acceptance path is broken. Synthetic fixtures are always labeled and isolated from real factory data.

## Phase 0 — Foundation

### Step 1 — Repository and development environment

- [x] Inspect the starting workspace
- [x] Establish architecture, data model, and Phase 1 specification
- [ ] Create modular backend/frontend structure
- [ ] Add environment configuration and safe defaults
- [ ] Add health endpoint and local start commands
- [ ] Add migration/test/lint configuration
- [ ] Document local development

### Step 2 — Tenant, factory, user, and authentication model

- [ ] Organization, factory, department, user, role, and membership models
- [ ] Secure password/session boundary
- [ ] Backend capability checks
- [ ] Tenant isolation tests
- [ ] First migration and seed flow

## Phase 1 — Automated Daily Report

### Step 3 — File registry and immutable storage

- [ ] Upload intake with size/type/safe-name validation
- [ ] SHA-256 hashing and factory-scoped deduplication
- [ ] Original object storage adapter
- [ ] Registry status lifecycle and audit events

### Step 4 — Workbook ingestion framework

- [ ] `.xlsx` parser and workbook manifest
- [ ] Practical `.xls` support or explicit unsupported response
- [ ] Sheet/header inspection
- [ ] Candidate report-type detection
- [ ] Processing run/error model

### Step 5 — Canonical schema and mappings

- [ ] Production-day canonical records
- [ ] Explicit aliases and configurable mappings
- [ ] Controlled fuzzy suggestions requiring review
- [ ] Unit/date/numeric normalization
- [ ] Versioned mapping and source-cell lineage

### Step 6 — Validation

- [ ] Required fields and type checks
- [ ] Date/unit/range/completeness checks
- [ ] Duplicate-row detection
- [ ] Visible validation issues and processing status

### Step 7 — Deterministic KPI engine

- [ ] Cane crushed
- [ ] Sugar produced
- [ ] Recovery
- [ ] Downtime
- [ ] Power generated
- [ ] Steam consumption
- [ ] KPI definition/version/status model
- [ ] Calculation lineage

### Step 8 — Historical baselines

- [ ] Yesterday comparison
- [ ] Available-history average with sample count
- [ ] 7-day/30-day labels that do not overstate history
- [ ] Season boundaries as factory configuration

### Step 9 — Rule-based anomalies

- [ ] Configurable KPI rules
- [ ] INFO/WARNING/CRITICAL severity
- [ ] Supporting evidence and acknowledgement state
- [ ] No causal claims unsupported by data

### Step 10 — Daily report

- [ ] Executive summary
- [ ] KPI scorecard
- [ ] Exceptions first
- [ ] Downtime and trends
- [ ] Source/audit references
- [ ] Versioned, reproducible HTML/PDF-ready output

### Step 11 — Dashboard and file management UI

- [ ] Management dashboard
- [ ] KPI cards, exceptions, trend view
- [ ] Drilldown to calculation and source file
- [ ] Upload/processing status/validation UI

### Step 12 — Audit/lineage interface

- [ ] Immutable audit event view
- [ ] KPI-to-source trace view
- [ ] Mapping/configuration history

### Step 13 — Automated daily pipeline

- [ ] Job orchestration after ingestion
- [ ] Idempotent reruns
- [ ] Processing lifecycle observability

### Step 14 — Email delivery

- [ ] Configurable recipients and schedule
- [ ] Delivery records and failure visibility
- [ ] Provider adapter, not credentials in frontend

### Step 15 — Acceptance hardening

- [ ] Synthetic multi-workbook end-to-end test
- [ ] Edge-case coverage from `PHASE_1_SPEC.md`
- [ ] Migration/startup/manual verification
- [ ] Security and documentation review

## Phase 2 — Factory Intelligence

Begin only after the Phase 1 acceptance test is passing. Add quality, energy, maintenance, inventory, chemicals, dispatch, laboratory, steam/power expansion, cross-department relationships, and richer comparisons.

## Phase 3 — AI Factory Analyst

Begin only after structured data and lineage are reliable. Use SQL/retrieval evidence first; use an LLM only as an explanation layer with citations and explicit uncertainty.

## Phase 4 — Predictive Intelligence

Future scope: predictive maintenance, recovery/production forecasting, energy optimization, cane procurement, and spare-parts intelligence. Not part of the initial build.

## Current risks

- Real workbooks may use layouts that cannot be safely inferred; ambiguous mappings must stop or require review.
- KPI definitions and factory units are not fully specified; they remain versioned/configurable.
- Production-day cutover and season boundaries require factory confirmation.
- S3/email deployment choices are environment decisions, not hard-coded assumptions.