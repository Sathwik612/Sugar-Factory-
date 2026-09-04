# Railway deployment

Railway is the recommended managed-hosting shape for this application when a
traditional VPS is not required. Railway does not run `compose.yaml` directly:
create separate `api` and `web` services, and use a Railway PostgreSQL service.
The committed Compose setup remains available for a conventional Linux host.

## Create the services

1. Create an empty Railway project.
2. Add a PostgreSQL service from Railway's database templates.
3. Add an `api` service from the reviewed GitHub branch.
   Railway will use the root `railway.toml` and `docker/api.Dockerfile`.
4. Add a `web` service from the same repository and branch. In the web
   service's Build settings, set Dockerfile Path to `docker/web.Dockerfile`.
5. Generate a public domain for the `web` service and attach the real custom
   domain after the first deployment. Railway terminates HTTPS for the public
   service; do not enable the Compose Caddy profile for this topology.

The API service should not have a public domain. The web service is the only
public entry point and proxies `/api/` over Railway private networking.

## Railway variables

### API service

Set these in the API service:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Railway variable reference to the Postgres service's `DATABASE_URL` |
| `SESSION_SECRET` | A unique secret of at least 32 characters |
| `CORS_ORIGIN` | The exact public `https://` web origin, without a trailing slash |
| `COOKIE_SECURE` | `true` |
| `TRUST_PROXY` | `1` |
| `FACTORY_TIMEZONE` | `Asia/Kolkata` |
| `SEED_DEMO_DATA` | `false` |
| `STORAGE_PROVIDER` | `s3` |
| `S3_BUCKET` | Private production bucket |
| `S3_REGION` | Bucket region |
| `S3_ACCESS_KEY_ID` | Storage credential with only the required bucket prefix access |
| `S3_SECRET_ACCESS_KEY` | Matching storage secret |
| `S3_ENDPOINT` | Set only for a non-AWS S3-compatible provider |
| `S3_FORCE_PATH_STYLE` | `true` only when required by the provider |

Railway injects `PORT`; the API image listens on that value. The startup
command retries the schema push while Postgres becomes available, then
optionally creates `BOOTSTRAP_ADMIN_*` once without overwriting an existing
administrator. Keep the bootstrap password set only until the first successful
bootstrap, then remove it from the service variables.

For a private local-storage pilot instead, set `STORAGE_PROVIDER=local` and
attach a Railway Volume to the API service at
`/var/lib/sugar-factory/uploads`. S3 is preferred because Railway service
filesystem data is not a substitute for an independently retained workbook
backup.

### Web service

Set:

| Variable | Value |
| --- | --- |
| `API_UPSTREAM` | Railway private-domain reference for the API service followed by `:8080` |

For example, use the API service's Railway private domain in the Railway
variable-reference form rather than hard-coding a public API URL. The web image
also honors Railway's injected `PORT`, so no fixed public port is needed.

## First deployment and smoke checks

After the services and variables are configured:

1. Deploy Postgres, then the API, and wait for `/api/readyz` to pass.
2. Deploy the web service and confirm the public domain serves the dashboard.
3. From a trusted shell, run:

   ```bash
   BASE_URL=https://<railway-web-domain> \
   SMOKE_USERNAME=<bootstrap-admin> \
   SMOKE_PASSWORD=<bootstrap-password> \
   ./scripts/vps-smoke.sh
   ```

   Do not commit or log the credential values.
4. Check response headers, HTTPS-only cookies, CORS rejection from an
   unapproved origin, and the authenticated Operations Suite flow.
5. Run the 25–30 request readiness check through the public HTTPS domain:

   ```bash
   BASE_URL=https://<railway-web-domain> \
   CONCURRENCY_REQUESTS=30 \
   ./scripts/concurrency-smoke.sh
   ```

Railway's healthcheck is a deployment gate and is not a substitute for
continuous monitoring after go-live. Configure Railway deployment alerts and
an external uptime check for the web domain.

## Restart and recovery

Use a Railway service restart/redeploy to verify application recovery, and
confirm database rows, source-file preview, lineage, and PDF generation remain
available. Railway has no operator-controlled host reboot in this topology, so
the VPS host-reboot checklist item is not applicable; record Railway platform
recovery and managed Postgres backup/restore evidence instead.

Before schema changes, take a Postgres backup. Keep an off-platform
`pg_dump --format=custom --no-owner --no-acl` copy and rehearse restoring it to
an isolated database. Database rows and source workbooks must be restored
together. Native Railway backups should supplement, not replace, an independent
backup copy and a recorded restore test.