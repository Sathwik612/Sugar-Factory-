# KPI Definitions

This document is the reviewable business definition for the KPIs currently
calculated by Sugar Factory Intelligence. The named calculation functions live
in:

```text
artifacts/api-server/src/lib/kpi.ts
```

The API is the source of truth. The browser must not calculate or overwrite
derived values.

## Calculation rules

- `null` or missing inputs produce `null` when a KPI cannot be calculated.
- A zero or negative denominator is never used for a ratio.
- Invalid numeric inputs are rejected or treated as unavailable at the
  validation boundary.
- Stoppage durations are stored in hours.
- Numeric database values are persisted with the precision supported by their
  target column; UI formatting is presentation only.
- Historical approved records must retain their persisted result context. A
  future formula change must not silently recalculate an approved historical
  record.

## Cane Crushed

**Purpose:** Measures the quantity of cane processed during the operating
period.

**Formula:** Source value; no derived formula.

**Inputs:**

- `production.caneCrushed`

**Units:** tonnes (`t`)

**Example:** A source value of `7,200` means 7,200 tonnes of cane crushed.

**Data source:** Manual Daily Operations entry or a future validated workbook
import.

**Code:** The value is normalized by `toFiniteNumber` and persisted by
`artifacts/api-server/src/routes/dailyOperations.ts`.

**Configurable:** No. The value is source data.

## Sugar Produced

**Purpose:** Measures sugar output during the operating period.

**Formula:** Source value; no derived formula.

**Inputs:**

- `production.sugarProduced`

**Units:** tonnes (`t`)

**Example:** A source value of `690` means 690 tonnes of sugar produced.

**Data source:** Manual Daily Operations entry or a future validated workbook
import.

**Code:** The value is normalized by `toFiniteNumber` and persisted by
`artifacts/api-server/src/routes/dailyOperations.ts`.

**Configurable:** No. The value is source data.

## Recovery

**Purpose:** Measures sugar produced as a percentage of cane crushed.

**Formula:**

```text
Recovery % = (Sugar Produced / Cane Crushed) × 100
```

**Inputs:**

- `production.sugarProduced`
- `production.caneCrushed`

**Units:** percentage (`%`).

**Example:**

```text
Sugar Produced = 100 t
Cane Crushed   = 1,000 t
Recovery       = (100 / 1,000) × 100 = 10%
```

**Data source:** Canonical Daily Operations production section.

**Code:** `calculateRecovery` in
`artifacts/api-server/src/lib/kpi.ts`.

**Configurable:** The formula is code-defined. Management warning and critical
thresholds are separate decision settings and must not change the historical
formula.

## Hours Lost

**Purpose:** Measures time unavailable within the declared time account.

**Formula:**

```text
Hours Lost = max(0, Available Hours − Hours Worked)
```

**Inputs:**

- `timeAccount.availableHours`
- `timeAccount.hoursWorked`
- Optional existing `timeAccount.hoursLost` fallback when the two primary
  inputs are unavailable.

**Units:** hours (`h`).

**Example:**

```text
Available Hours = 24 h
Hours Worked    = 20 h
Hours Lost      = max(0, 24 − 20) = 4 h
```

**Data source:** Canonical Daily Operations time-account section.

**Code:** `calculateHoursLost` in
`artifacts/api-server/src/lib/kpi.ts`.

**Configurable:** No. The default formula is code-defined.

## Downtime

**Purpose:** Provides the current management downtime KPI used by the
dashboard, report, and alert flows.

**Formula:**

```text
Downtime = Hours Lost
```

**Inputs:** The same inputs as Hours Lost.

**Units:** hours (`h`).

**Example:** If the time account produces 4 hours lost, the management
downtime KPI is 4 hours.

**Data source:** Canonical Daily Operations time-account section.

**Code:** The value is returned as `timeAccount.hoursLost` by
`calculateDailyOperationValues`; the canonical KPI row is written by
`artifacts/api-server/src/routes/dailyOperations.ts`.

**Configurable:** No. This alias exists to preserve the current management
contract. A future domain change should update the central definition and its
validation tests together.

## Stoppage Hours

**Purpose:** Aggregates all valid stoppage entries.

**Formula:**

```text
Stoppage Hours = Σ(End Time − Start Time), expressed in hours
```

**Inputs:**

- `stoppages[].startTime`
- `stoppages[].endTime`

**Units:** hours (`h`).

**Example:**

```text
Stoppage 1 = 01:00 to 02:30 = 1.5 h
Stoppage 2 = 10:00 to 10:45 = 0.75 h
Total      = 2.25 h
```

**Data source:** Canonical Daily Operations stoppage register.

**Code:** `calculateStoppageDuration` and
`calculateTotalStoppageHours` in
`artifacts/api-server/src/lib/kpi.ts`.

**Configurable:** No. The duration unit is fixed at hours.

## Power Generated

**Purpose:** Measures gross power generation.

**Formula:** Source value; no derived formula.

**Inputs:** `energy.powerGenerated`, with the existing production-level
fallback accepted by the canonical calculation.

**Units:** kilowatt-hours (`kWh`).

**Example:** A source value of `11,840` means 11,840 kWh generated.

**Data source:** Canonical Daily Operations energy section.

**Code:** Input normalization is performed by
`calculateDailyOperationValues` in `artifacts/api-server/src/lib/kpi.ts`.

**Configurable:** No. The value is source data.

## Power Used

**Purpose:** Measures factory power consumption.

**Formula:** Source value; no derived formula.

**Inputs:** `energy.powerUsed`.

**Units:** kilowatt-hours (`kWh`).

**Example:** A source value of `4,000` means 4,000 kWh used by the factory.

**Data source:** Canonical Daily Operations energy section.

**Code:** Input normalization is performed by
`calculateDailyOperationValues` in `artifacts/api-server/src/lib/kpi.ts`.

**Configurable:** No. The value is source data.

## Power Exported

**Purpose:** Measures power available for export after factory use.

**Formula:**

```text
Power Exported = max(0, Power Generated − Power Used)
```

**Inputs:**

- `energy.powerGenerated`
- `energy.powerUsed`

**Units:** kilowatt-hours (`kWh`).

**Example:**

```text
Power Generated = 5,000 kWh
Power Used      = 4,000 kWh
Power Exported  = max(0, 5,000 − 4,000) = 1,000 kWh
```

**Data source:** Canonical Daily Operations energy section.

**Code:** `calculatePowerExported` in
`artifacts/api-server/src/lib/kpi.ts`.

**Configurable:** No. The non-negative floor is a safety rule.

## Power per Tonne Cane

**Purpose:** Normalizes factory power use against cane crushed.

**Formula:**

```text
Power per Tonne Cane = Power Used / Cane Crushed
```

**Inputs:**

- `energy.powerUsed`
- `production.caneCrushed`
- Optional existing `efficiency.powerKwhPerMtCane` fallback when the primary
  inputs are unavailable.

**Units:** kilowatt-hours per tonne cane (`kWh/t cane`).

**Example:**

```text
Power Used    = 4,000 kWh
Cane Crushed  = 1,000 t
Power / tonne = 4 kWh/t cane
```

**Data source:** Canonical Daily Operations energy and production sections.

**Code:** `calculatePowerKwhPerMtCane` in
`artifacts/api-server/src/lib/kpi.ts`.

**Configurable:** No. The denominator and unit are code-defined.

## Steam Consumption

**Purpose:** Measures normalized steam consumption supplied by the energy
section.

**Formula:** Source value, normalized to a finite number.

**Inputs:** `energy.steamConsumption`.

**Units:** tonnes steam per tonne cane (`t/t cane`).

**Example:** A source value of `3.24` means 3.24 tonnes steam per tonne cane
under the current factory data contract.

**Data source:** Canonical Daily Operations energy section.

**Code:** `calculateDailyOperationValues` in
`artifacts/api-server/src/lib/kpi.ts`.

**Configurable:** No. The current application retains the supplied normalized
value rather than deriving steam from another field.

## KPI status decision rules

The current default status rules are centralized in
`DEFAULT_KPI_THRESHOLDS` in `artifacts/api-server/src/lib/kpi.ts` and applied by
`calculateKpiStatus`.

| KPI | Direction | Watch threshold | Critical threshold |
|---|---|---:|---:|
| Recovery | Lower is worse | `< 9.4%` | `< 9.1%` |
| Downtime | Higher is worse | `> 10 h` | `> 12 h` |

Statuses are:

```text
GOOD → within threshold
WATCH → warning threshold crossed
CRITICAL → critical threshold crossed
```

These are current application defaults, not factory-management sign-off. The
future configuration UI must validate and audit any threshold change, and
historical records must retain the threshold/result context used when they were
approved.

## Change procedure

When a formula changes:

1. Change the named function in `src/lib/kpi.ts`.
2. Update this document.
3. Add or update independent expected-value tests in
   `tests/unit/kpi.test.ts`.
4. Update `docs/CALCULATION_VALIDATION.md`.
5. Run `pnpm run test:kpi`, `pnpm run typecheck`, and `pnpm run build`.
6. Obtain factory-management sign-off before using the new formula with real
   operational data.