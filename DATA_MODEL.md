# Sugar Factory Intelligence Platform — Data Model

## Modeling principles

- Raw files are immutable.
- Derived records are reproducible and versioned.
- Every important number has source lineage.
- Every business row is tenant-scoped.
- Missing/invalid data is represented explicitly, never replaced with a guess.
- Configuration changes create versions and audit events.

## Entity hierarchy

```text
Organization
  └── Factory
        ├── Department
        ├── UserMembership → User
        ├── ProductionDay
        │     ├── CanonicalRecord
        │     ├── KPIValue → KPIInputLineage
        │     ├── Anomaly
        │     └── DailyReport → ReportVersion
        ├── SourceFile
        │     ├── WorkbookSheet
        │     ├── ProcessingRun → ValidationIssue
        │     └── SourceCell/SourceRow lineage
        ├── MappingConfiguration → MappingRule
        ├── KPIDefinition → KPIThreshold
        └── AnomalyRule
```

## Core tables

### `organizations`

`id`, `name`, `created_at`, `updated_at`.

### `factories`

`id`, `organization_id`, `name`, `timezone`, `default_currency`, `active`, `created_at`, `updated_at`.

### `departments`

`id`, `factory_id`, `name`, `code`, `active`.

### `users` and `memberships`

Users hold authentication identity. A membership connects a user to an organization/factory and a role. No operational query trusts a client-provided factory ID.

### `production_days`

`id`, `factory_id`, `production_date`, `status`, `season_id`, `created_at`, `updated_at`.

Unique constraint: `(factory_id, production_date)`.

### `source_files`

`id`, `factory_id`, `filename`, `original_filename`, `sha256`, `file_size`, `uploaded_at`, `source`, `report_type`, `reporting_date`, `processing_status`, `processing_started_at`, `processing_completed_at`, `parser_version`, `mapping_version`, `validation_status`, `error_message`, `storage_key`, `is_synthetic`, `created_by`.

Unique constraint: `(factory_id, sha256)`. The file bytes are outside the relational database in an immutable storage adapter.

Statuses: `RECEIVED`, `HASHED`, `PARSING`, `MAPPING`, `VALIDATING`, `PROCESSED`, `WARNING`, `FAILED`, `DUPLICATE`.

### `workbook_sheets`

`id`, `source_file_id`, `sheet_name`, `sheet_index`, `header_row`, `row_count`, `detected_report_type`, `inspection_json`.

### `processing_runs`

`id`, `source_file_id`, `run_number`, `correlation_id`, `status`, `started_at`, `completed_at`, `parser_version`, `mapping_version`, `error_summary`.

### `validation_issues`

`id`, `processing_run_id`, `severity`, `code`, `message`, `sheet_name`, `row_number`, `column_name`, `cell_reference`, `details_json`, `resolved_at`.

### `mapping_configurations` and `mapping_rules`

Configuration is immutable by version. A rule records `source_report_type`, `source_sheet_pattern`, `source_column_pattern`, `canonical_field`, `transformation`, `unit_conversion`, `confidence`, `review_state`, `version`, and audit metadata.

### `canonical_records`

`id`, `factory_id`, `production_day_id`, `source_file_id`, `processing_run_id`, `record_type`, `payload_json`, `normalized_at`, `schema_version`, `row_fingerprint`.

Phase 1 may use a typed production payload while retaining a generic record envelope for future departments.

### `lineage_entries`

`id`, `factory_id`, `canonical_record_id`, `source_file_id`, `processing_run_id`, `source_sheet`, `source_row`, `source_column`, `cell_reference`, `canonical_field`, `raw_value`, `normalized_value`, `transformation_json`.

### `kpi_definitions`

`id`, `factory_id`, `kpi_code`, `name`, `description`, `formula`, `unit`, `frequency`, `source_fields_json`, `calculation_version`, `baseline_method`, `active`.

### `kpi_values`

`id`, `factory_id`, `production_day_id`, `kpi_definition_id`, `value`, `unit`, `status`, `sample_context_json`, `calculation_version`, `calculated_at`.

Statuses distinguish `AVAILABLE`, `INCOMPLETE`, `UNAVAILABLE`, and `INVALID`.

### `kpi_lineage`

`id`, `kpi_value_id`, `lineage_entry_id`, `input_role`, `input_value`, `formula_step`.

### `anomaly_rules` and `anomalies`

Rules hold configurable comparison direction, threshold, baseline method, and severity. An anomaly stores the immutable evaluation result: KPI, actual, baseline, deviation, severity, rule version, explanation, evidence JSON, and acknowledgement fields.

Operational alerts use the latest valid observation for each factory, production date, and rule key. Only one open or acknowledged alert can exist for that key. Severity is latched at the highest level reached until the observation returns inside the warning limit; at that point the alert is automatically resolved. Missing values do not prove recovery and therefore do not resolve an alert. A later breach starts a new alert cycle, while a critical escalation clears the earlier acknowledgement and requires a fresh one.

### `daily_reports`

`id`, `factory_id`, `production_day_id`, `report_date`, `status`, `report_version`, `input_snapshot_hash`, `html_storage_key`, `generated_at`, `generated_by`, `delivery_status`.

The snapshot hash makes report reproducibility checkable.

### `audit_events`

`id`, `organization_id`, `factory_id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `occurred_at`, `correlation_id`, `metadata_json`.

Audit events are append-only from the application UI.

## Phase 1 canonical production fields

| Field | Type | Unit | Required for |
|---|---|---|---|
| `production_date` | date | local factory date | all production records |
| `cane_crushed` | decimal | tonnes | crushing/recovery |
| `sugar_produced` | decimal | tonnes | production/recovery |
| `recovery` | decimal | percent | supplied or derived, never both without provenance |
| `downtime` | decimal | hours | downtime KPI |
| `power_generated` | decimal | kWh or configured unit | power KPI |
| `steam_consumption` | decimal | tonnes or configured unit | steam KPI |

The canonical model stores numeric values as decimal-compatible values with explicit units and source transformations. Unit conversions are configuration, not implicit guesses.

## Important constraints

- Numeric values cannot enter KPI calculations from a validation-error record.
- A KPI with missing required inputs is `UNAVAILABLE` or `INCOMPLETE`, not zero.
- A workbook hash collision within a factory is a duplicate, not a second processing run.
- A mapping change creates a new mapping version and does not rewrite historical lineage.