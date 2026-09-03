# Production deployment

## Required configuration

Use secret storage for database credentials and `SESSION_SECRET`. Set `NODE_ENV=production`, an HTTPS `CORS_ORIGIN`, `COOKIE_SECURE=true`, and `TRUST_PROXY=1` behind one trusted reverse proxy. Keep `SEED_DEMO_DATA=false` unless deliberately creating a demo environment.

For a normal local checkout, use `.env` rather than Replit secrets. `pnpm run dev:local` starts the API on port 8080 and the dashboard on port 5173. `pnpm run db:push:local` loads the local `.env` before applying the Drizzle schema.

Run `pnpm --filter @workspace/db run push` as a controlled release step before starting a new application version. Verify `/api/healthz` for liveness and `/api/readyz` for database readiness.

## Docker Compose

Docker is optional and is not used by Replit workflows. On a Docker-capable host:

1. Copy `.env.example` to a protected environment file and replace placeholders.
2. Build with `docker compose build`.
3. Apply the database schema from a controlled CI/release host.
4. Start with `docker compose up -d`.
5. Verify `curl -fsS http://localhost:8080/api/readyz`.

Terminate with SIGTERM. The API stops accepting connections, drains the HTTP server, and closes the PostgreSQL pool before the shutdown deadline.

## HTTPS and proxy

Terminate TLS at a managed load balancer or reverse proxy. Forward `Host`, `X-Forwarded-Proto`, and `X-Forwarded-For`; set `TRUST_PROXY` only to the known proxy hop count. Redirect HTTP to HTTPS outside the app and monitor repeated `429`, readiness failures, login failures, and unhandled request errors.

## Rollout and rollback

Back up PostgreSQL before schema changes. Deploy one release, check readiness, authenticate, save a draft, and inspect logs before shifting all traffic. Roll back application code independently; restore the database only when the migration is incompatible and the restore has been rehearsed.