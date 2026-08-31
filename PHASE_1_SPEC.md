# Phase 1 Specification — Automated Daily Report

## Goal

Given a realistic day's synthetic or real factory Excel workbooks, produce a correct, auditable daily management report without manual database editing.

## Acceptance workflow

1. Authorized user uploads one or more `.xlsx` files.
2. Each original is hash-checked, stored immutably, and registered.
3. Exact duplicates are identified and not processed twice.
4. Sheets, headers, row counts, and candidate report types are recorded.
5. A versioned mapping maps reviewed source fields into canonical production fields.
6. Validation records errors, warnings, and informational findings with coordinates.
7. Valid canonical records are stored for the factory and production date.
8. Deterministic KPI calculations run from canonical values.
9. Baselines use only available history and show sample context.
10. Rule-based anomalies are generated with evidence and severity.
11. An HTML/PDF-ready report is generated and versioned.
12. Dashboard users can inspect KPI → calculation → source file/sheet/row/cell.
13. Upload, processing, mapping, validation, KPI, report, and delivery events are auditable.

## Initial report types

The first parser targets production-related workbooks and detects, rather than assumes, these candidates:

- Production
- Cane Crushing
- Sugar
- Recovery
- Downtime
- Power Generation
- Steam

Other workbook types may be registered and preserved but remain unsupported until a mapping is configured.

## KPI definitions

| KPI | Formula/source | Unit | Availability |
|---|---|---|---|
| Cane Crushed | canonical `cane_crushed` | tonnes | source field required |
| Sugar Produced | canonical `sugar_produced` | tonnes | source field required |
| Recovery | `sugar_produced / cane_crushed × 100` | % | both inputs present and denominator > 0 |
| Downtime | canonical `downtime` | hours | source field required |
| Power Generated | canonical `power_generated` | configured unit | source field required |
| Steam Consumption | canonical `steam_consumption` | configured unit | source field required |

The calculation engine owns the formula. A source workbook's recovery value can be retained as a source observation, but it cannot override the deterministic calculated value.

## Baselines

For each available KPI:

- Yesterday: previous available production day
- 7-day average: up to seven prior available days, labeled with actual sample count
- 30-day average: up to thirty prior available days, labeled with actual sample count
- Current season: configured season window and sample count
- Prior season: only when a comparable configured season exists

No baseline is fabricated. A missing history value is displayed as unavailable.

## Anomaly rules

Initial rules are deterministic and configurable:

- Recovery below baseline by threshold
- Downtime above baseline by threshold
- Production below baseline by threshold
- Steam consumption above baseline by threshold
- Power generation below baseline by threshold

Each result includes `actual`, `baseline`, absolute/percentage deviation where meaningful, rule version, severity, explanation, and supporting KPI/source lineage. Rules do not claim a root cause.

## Daily report shape

1. Executive summary: what is available and the highest-severity exceptions.
2. KPI scorecard: today, yesterday, available-history average, status, sample count.
3. Exceptions: important anomalies first; no data dump.
4. Downtime: total and available contributors.
5. Trends: recent KPI history with missing days visible.
6. Source/audit: report version, input files, formulas, and drill-down references.

## File management requirements

Authorized users can upload files, see status, inspect warnings/failures, view detected report type and metadata, inspect validation issues, and open source references. Managers should see actionable language such as “Cane Crushed column was not found on sheet Crushing” rather than a raw stack trace.

## Synthetic fixtures

The demo generator creates several days of explicitly synthetic workbooks with variation in aliases, sheet names, date formats, column ordering, missing values, and controlled anomalies. Synthetic records have `is_synthetic=true` and are never mixed into real production queries.

## Required tests

### Unit

- SHA-256 and safe filename handling
- deduplication
- workbook/sheet/header inspection
- report-type detection
- explicit/alias mapping
- controlled fuzzy suggestion behavior
- unit/date/numeric normalization
- validation severity and coordinates
- KPI formulas and unavailable inputs
- baseline sample labels
- anomaly thresholds
- lineage creation
- backend permission checks

### Integration/end-to-end

```text
synthetic Excel files
  → upload/registry
  → parsing/mapping/validation
  → canonical storage
  → KPI/baselines/anomalies
  → report
  → dashboard/lineage read
```

Edge cases: missing sheet/column, duplicate file, duplicate rows, invalid date, malformed numeric, missing KPI input, unexpected units, extreme value, and partial data.

## Explicit assumptions to validate

- Factory local timezone controls production-day normalization.
- Phase 1 stores decimal values in canonical units; conversions require an explicit configured unit.
- “Yesterday” means the previous available production day, while the report labels the gap.
- The default recovery threshold and other anomaly thresholds are configuration, not hard-coded product truth.
- Email delivery and watched-folder ingestion are adapters after the core upload path works.