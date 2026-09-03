# Calculation Validation

This document records the independent validation approach for the critical KPI
functions in `artifacts/api-server/src/lib/kpi.ts`.

The automated cases are in:

```text
tests/unit/kpi.test.ts
```

Run them with:

```bash
pnpm run test:kpi
```

## Validation matrix

| KPI | Independent check | Edge cases covered |
|---|---|---|
| Recovery | Sugar tonnes divided by cane tonnes, multiplied by 100 | Zero denominator, missing input, decimal input, negative denominator |
| Hours Lost | Available hours minus worked hours with a zero floor | Missing values, supplied fallback, worked greater than available |
| Stoppage duration | End clock time minus start clock time in hours | Invalid clock value, same time, overnight duration |
| Stoppage total | Sum of individual durations | Empty list, null duration |
| Power Exported | Generated minus used with a zero floor | Missing input, used greater than generated |
| Power per tonne cane | Power used divided by positive cane tonnes | Zero denominator, fallback, decimal input |
| Daily operation values | Derived sections preserve source fields and add canonical values | Nulls, empty stoppage list, fallback values |
| KPI status | Direction-aware warning/critical comparison | Boundary values, missing thresholds, null value |

## Independently checked examples

### Recovery

```text
Expected = (100 t / 1,000 t) × 100 = 10%
```

### Hours lost

```text
Expected = max(0, 24 h − 20 h) = 4 h
```

### Stoppage

```text
01:00 → 02:30 = 1.5 h
10:00 → 10:45 = 0.75 h
Total          = 2.25 h
```

### Power

```text
Expected export = max(0, 5,000 kWh − 4,000 kWh) = 1,000 kWh
Expected rate   = 4,000 kWh / 1,000 t = 4 kWh/t cane
```

## Safe failure rules

- A ratio with a zero or negative denominator returns `null`.
- A missing required input returns `null` rather than zero.
- Invalid clock values return `null`.
- Negative output values are rejected by Daily Operations validation before
  calculation.
- A power-export result never becomes negative.
- Hours lost never becomes negative.

This validation suite verifies calculation behavior. It does not replace
factory-management review of the business definitions, units, source mapping,
or imported real-world data.