# Real Factory Data Validation

This is the controlled onboarding procedure for moving from synthetic demo
records to real factory records. Demo data and production data must remain
separately identifiable.

## Data classes

| Class | Meaning | Allowed in pilot decisions |
|---|---|---|
| `DEMO DATA` | Seeded synthetic records for training and UI verification | No |
| `PRODUCTION DATA` | Factory-provided, validated, reconciled records | Yes after sign-off |

The factory seed rows are marked as demo records. Do not copy synthetic rows
into a production factory or treat them as a baseline for operational action.

## Validation chain

```text
Source file or manual entry
        ↓
Source registration
        ↓
File hash and metadata
        ↓
Workbook/sheet inspection
        ↓
Column and unit mapping
        ↓
Value validation
        ↓
Duplicate/conflict check
        ↓
Canonical Daily Operations record
        ↓
Deterministic KPI calculation
        ↓
Manager review and approval
        ↓
Management report and export
```

## Required validation record

For every real data load, retain:

- Source name and owner
- Original filename and upload time
- Reporting date and season
- Factory and department
- File type and size
- SHA-256 checksum
- Workbook and sheet names
- Mapping version
- Parser version
- Required fields found/missing
- Unit interpretation
- Valid row count
- Warning count
- Error count
- Duplicate/conflict result
- Import operator
- Reviewer and approval decision
- Reconciliation notes
- Management sign-off

## Manual entry validation

Before submission:

- Production date must be valid.
- Cane crushed and sugar produced cannot be negative.
- Sugar produced cannot be positive when cane crushed is zero.
- Hours worked cannot exceed available hours.
- Stoppage end time must be after start time under the current Daily Operations
  validation contract.
- Derived values must come from the server.
- The operator must submit only the sections owned by their department.

## Workbook validation requirements

The planned workbook importer must validate:

- Supported extension and MIME type
- Required sheets
- Required columns
- Date format
- Numeric values
- Units
- Duplicate records
- Negative values where invalid
- Impossible values
- Department ownership
- Existing database conflicts
- KPI prerequisites

The current parser supports both `.xlsx` and `.xls` through SheetJS. The pilot
must still test at least one representative legacy `.xls` workbook from the
factory before accepting it as a standard source. If a legacy workbook uses
macros, external links, unusual date systems, or merged headers, convert it to
an approved `.xlsx` template and retain the original as the source artifact.

Errors must identify the workbook location, for example:

```text
Sheet: Production
Row: 14
Column: Cane Crushed
Cell: H14
Error: Expected a numeric value.
```

An import with errors must be previewable and cancellable. It must not silently
overwrite existing records.

## Reconciliation checklist

The reviewer should compare imported values with the originating factory
document:

- Cane crushed total
- Sugar produced total
- Recovery calculation
- Operating hours and hours lost
- Stoppage totals
- Power generated, used, and exported
- Steam consumption
- Quality readings
- Materials quantities
- Reporting date and shift

Where a source workbook supplies a recovery value, the application’s
deterministic recovery calculation remains authoritative. A source recovery
value can be retained as a source observation for comparison, but it must not
replace the canonical result without an approved business-rule change.

## Sign-off

Production data is ready for operational use only after:

1. The source owner confirms the source file.
2. The operator confirms the mapping and validation output.
3. The reviewer confirms reconciliation.
4. The manager approves the canonical record.
5. Management signs off on the KPI interpretation and units.

Record the sign-off outside the application until a formal UAT/sign-off module
is added.