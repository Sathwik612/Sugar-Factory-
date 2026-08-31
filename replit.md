# Sugar Factory Intelligence

An operational dashboard that turns sugar-mill source reports into a traceable daily management view.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/sugar-factory-dashboard` — React/Vite dashboard and route-level UI
- `artifacts/api-server` — shared Express API for dashboard, reports, lineage, and source registry
- `lib/api-spec/openapi.yaml` — source of truth for API contracts
- `lib/db/src/schema` — source of truth for PostgreSQL tables
- `ARCHITECTURE.md`, `ROADMAP.md`, `DATA_MODEL.md`, `PHASE_1_SPEC.md` — product and implementation plans

## Architecture decisions

- Phase 1 is a modular monolith; the data-processing seams remain replaceable without premature microservices.
- The frontend consumes generated API hooks rather than hand-written response types.
- Demo rows are explicitly synthetic and scoped to a demo factory.
- KPI values and source lineage are separate concepts so future deterministic calculations can be audited.

## Product

- Daily management overview with six production KPIs, statuses, comparisons, trends, and exceptions
- Daily report with downtime profile and KPI-to-source lineage
- Source registry with processing state, validation issues, and history
- Readiness surface for the operational contract

## User preferences

No standing preferences recorded.

## Gotchas

- Run API codegen after every OpenAPI change.
- The dashboard Vite build needs `PORT` and `BASE_PATH`; managed workflows provide them automatically.
- The current source-file intake registers metadata only; immutable object storage and real workbook bytes are the next ingestion slice.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
