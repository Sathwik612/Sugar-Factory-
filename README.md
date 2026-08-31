# Sugar Factory Intelligence

Sugar Factory Intelligence turns daily sugar-mill Excel reports into a traceable management view. The current Phase 1 foundation includes a typed dashboard, daily report view, source registry, cell-level lineage references, and synthetic data clearly separated from future real factory data.

## Run locally

The project uses pnpm workspaces and the preconfigured PostgreSQL database.

```bash
pnpm install
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/sugar-factory-dashboard run dev
```

The managed workflows provide `PORT` and `BASE_PATH`. For a direct production build:

```bash
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/sugar-factory-dashboard run build
```

## Checks

```bash
pnpm run typecheck
pnpm --filter @workspace/api-spec run codegen
```

## Current product surface

- `/` — latest daily management view
- `/reports/:productionDate` — report scorecard, exceptions, downtime profile, and lineage
- `/files` — source file registry with status filters and intake registration
- `/files/:fileId` — workbook structure, processing history, and validation issues
- `/settings` — readiness and operating contract

The database seed is explicitly synthetic and exists to exercise the dashboard before real workbook ingestion is enabled. It is never presented as production data.