# Generic VPS deployment

This application is designed to run as a small modular monolith for a factory
team of approximately 25–30 users:

```text
Browser --HTTPS--> host reverse proxy --HTTP--> web container (Nginx)
                                      /api --> API container (Express)
                                             --> PostgreSQL
                                             --> S3-compatible storage
```

The production path does not depend on Replit runtime services. The API uses
S3-compatible storage for source workbooks by default in this guide. A
persistent local filesystem provider is also supported for a single VPS when
the backup policy below is followed.

## Prerequisites

- A Linux VPS with Docker Engine and Compose v2.
- A DNS record pointing the application hostname at the VPS.
- HTTPS terminated by a host-level Nginx, Caddy, or managed load balancer.
- PostgreSQL 15+ (the included PostgreSQL 17 Compose service is suitable for a
  pilot; a managed database is preferred for production).
- An S3-compatible bucket with private access, or a dedicated persistent disk
  for local storage.
- At least 2 vCPU, 4 GB RAM, and 40 GB of free disk for a small pilot,
  excluding database and object-storage retention.

## Configuration

```bash
cp .env.production.example .env
chmod 600 .env
openssl rand -base64 48
```

Replace every `replace-with-*` value. Set `CORS_ORIGIN` to the exact public
HTTPS origin, without a trailing slash. Keep `COOKIE_SECURE=true` when HTTPS is
enabled. `TRUST_PROXY=1` is appropriate when exactly one trusted reverse proxy
is in front of the Compose web service; use the correct hop count or trusted
subnet for a different topology.

For S3:

- Set `STORAGE_PROVIDER=s3`, bucket, region, access key, and secret.
- Keep the bucket private and grant only object read/write access to the
  application prefix.
- Set `S3_ENDPOINT` for MinIO or another non-AWS S3-compatible service.
- Use `S3_FORCE_PATH_STYLE=true` when required by that service.

For local storage:

- Set `STORAGE_PROVIDER=local`.
- Set `STORAGE_LOCAL_PATH=/var/lib/sugar-factory/uploads` or another absolute
  persistent path.
- Back up that directory and PostgreSQL together; restoring only one breaks
  source-file lineage.

The API refuses to start in production when the storage provider, database
credentials, session secret, CORS origin, cookie security, or other required
settings are missing. Demo seeding is disabled in production.

## First launch

```bash
docker compose build
docker compose up -d db
docker compose run --rm api pnpm --filter @workspace/db run push
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:8080/api/readyz
```

The application is exposed only through the `web` service. Do not publish the
database or API ports to the public internet. The web container serves the
dashboard and proxies `/api/` to the API container.

Place a host reverse proxy in front of port 8080. A minimal host Nginx shape is:

```nginx
server {
  listen 443 ssl http2;
  server_name sugar.example.com;
  # certificate configuration omitted
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Set `WEB_BIND_ADDRESS=127.0.0.1` if the deployment should not bind the
internal web service on every host interface.

## Updates and rollback

1. Take a PostgreSQL backup and confirm object-storage backups are current.
2. Pull the reviewed commit.
3. Run `docker compose build`.
4. Run the database schema push or reviewed migration procedure.
5. Run `docker compose up -d`.
6. Check `/api/readyz`, login, one dashboard report, and source-file preview.
7. Keep the previous image available until the smoke checks pass.

Schema changes are additive and should be reviewed before applying. Do not
delete or recreate the database as an update strategy.

## Operations

- Monitor `docker compose logs --since=15m api` and the host reverse-proxy logs.
- Alert on repeated readiness failures, container restarts, disk exhaustion,
  PostgreSQL connection exhaustion, and backup failures.
- The API has bounded PostgreSQL pooling, request-size limits, rate limiting,
  secure session cookies, strict CORS behavior, and graceful shutdown.
- Keep web-push variables empty unless push notifications are intentionally
  enabled.
- Do not enable `SEED_DEMO_DATA` in a production environment.

## Concurrency smoke test

After the stack is serving locally, run the included 25–30-user readiness
smoke test:

```bash
BASE_URL=http://127.0.0.1:8080 CONCURRENCY_REQUESTS=30 ./scripts/concurrency-smoke.sh
```

It runs concurrent database-backed readiness requests and reports completed
responses, failures, p95, and maximum latency. Repeat it through the HTTPS
reverse proxy and retain the output with the deployment record.

## Backups and retention

PostgreSQL and source workbooks are a single recoverable unit:

- Run `scripts/backup-postgres.sh` daily and copy encrypted dumps off-host.
- For local storage, snapshot or copy `STORAGE_LOCAL_PATH` daily and retain
  matching database and object backups.
- For S3 storage, enable bucket versioning and lifecycle retention, and use
  provider-side replication or a second encrypted backup bucket when required.
- Keep at least 30 daily backups and monthly archives according to factory
  policy. Restrict backup access and never commit credentials.
- Test restores monthly on an isolated database and storage prefix. Record the
  backup identifiers, restore duration, record counts, authentication check,
  approval-lock check, audit-log check, and source-file download/lineage check.

See [BACKUPS.md](./BACKUPS.md) for the database restore command and the
minimum validation record.

## VPS readiness check

Run the checklist in [docs/VPS_READINESS_CHECKLIST.md](./docs/VPS_READINESS_CHECKLIST.md)
before handing the system to operators.