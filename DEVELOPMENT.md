# Development Notes

## Contract-first API

The API contract lives in `lib/api-spec/openapi.yaml`. After changing it, regenerate the typed React hooks and server validation schemas:

```bash
pnpm --filter @workspace/api-spec run codegen
```

Do not hand-edit generated files.

## Database

The schema source is `lib/db/src/schema/`. Apply development changes with:

```bash
pnpm --filter @workspace/db run push
```

The development database is preconfigured. Production schema changes are applied through the platform's publish flow.

## Backend

The shared Express API server is in `artifacts/api-server`. It owns dashboard, report, lineage, and source registry routes under `/api`. Use the existing API workflow rather than creating a second server workflow.

## Frontend

The React/Vite application is in `artifacts/sugar-factory-dashboard`. It uses generated hooks from `@workspace/api-client-react`, Wouter routes, and the shared UI scaffold.

## Data integrity

Raw files must remain immutable. Mappings, validation decisions, KPI calculations, and report versions must remain inspectable and versioned as ingestion expands. Missing data must stay visible; it must not become a fabricated zero.