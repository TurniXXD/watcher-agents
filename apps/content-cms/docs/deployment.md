# Deployment

The CMS is the opt-in `content-cms` service in `docker-compose.production.yml`
(Compose profile `content-cms`). The deploy workflow publishes its image
`ghcr.io/<owner>/vantuch-content-cms:<release sha>` together with the Watcher
image, but `deploy/deploy.sh` never pulls, starts, or restarts it. Starting and
updating the CMS is a deliberate manual step.

## Topology

```
Internet ─▶ Cloudflare (DNS + Access) ─▶ cloudflared (vantuch network)
                                            └─▶ vantuch-content-cms:3000  (content-cms container)
                                                     ├─▶ watcher-postgres, database content_cms (default network)
                                                     └─▶ rustfs:9000 (existing, vantuch network)
brno-events-agent (Watcher stack, vantuch network) ─▶ http://vantuch-content-cms:3000/api/ingest/v1
```

The CMS uses a dedicated `content_cms` database and role on the existing
`watcher-postgres` instance; Payload migrations are separate from Prisma
migrations. The CMS publishes only a loopback fallback
(`127.0.0.1:${CONTENT_CMS_HOST_PORT:-3100}`). RustFS and PostgreSQL consoles must
never be routed through cloudflared.

## First deployment (`/opt/watcher`)

Merge to `main` and let the normal Watcher release finish first, so the CMS
image for the current release SHA exists and `.release.env` points to it.

1. Create the database and role (once):

```bash
cd /opt/watcher
CMS_DB_PASSWORD="$(openssl rand -hex 32)"
docker compose --env-file deploy/runtime/compose.env -f docker-compose.production.yml \
  exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<SQL
CREATE ROLE content_cms LOGIN PASSWORD '$CMS_DB_PASSWORD';
CREATE DATABASE content_cms OWNER content_cms;
SQL
echo "$CMS_DB_PASSWORD"   # put it into DATABASE_URI below
```

2. Create `deploy/runtime/content-cms.env` (mode `0600`) from
   `deploy/presets/content-cms.env.example`:
   `DATABASE_URI=postgresql://content_cms:<password>@watcher-postgres:5432/content_cms`,
   `PAYLOAD_SECRET=$(openssl rand -hex 32)`, `SERVER_URL=https://cms.vantuch.dev`,
   `CORS_ORIGINS`, and the RustFS key. `deploy/render-env.sh` does not manage this file.

```bash
install -m 600 /dev/null deploy/runtime/content-cms.env   # then edit
```

3. Start it:

```bash
CMS="docker compose --env-file deploy/runtime/compose.env --env-file .release.env -f docker-compose.production.yml --profile content-cms"
$CMS pull content-cms
$CMS up -d content-cms
$CMS ps content-cms
curl -fsS http://127.0.0.1:3100/api/ready
```

`.release.env` (written by `deploy.sh`) pins the image to the deployed release SHA.

## Runtime behaviour

The container applies pending Payload migrations on startup, runs as the
non-root `node` user with a read-only root filesystem, `no-new-privileges`,
`init`, bounded JSON logs, a 1 GiB memory limit, and `restart: unless-stopped`.
Invalid configuration stops the process at boot with a message naming the
variable (never its value). On `SIGTERM` the instance reports `/api/ready` as
unavailable and Next.js closes the HTTP server before exiting
(`stop_grace_period: 30s`).

Then open `https://cms.vantuch.dev/admin`, create the first (admin) user, create
editor/reviewer accounts, set **Settings**, and create bot credentials.

## Updates and rollback

After a Watcher release has deployed (which published the matching CMS image):

```bash
cd /opt/watcher
CMS="docker compose --env-file deploy/runtime/compose.env --env-file .release.env -f docker-compose.production.yml --profile content-cms"
$CMS exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d content_cms -Fc' > backups/content-cms-$(date +%F-%H%M).dump
$CMS pull content-cms
$CMS up -d content-cms
```

To roll back, run `up -d content-cms` with `--env-file .release.env.previous`
instead of `.release.env`. Migrations are not reverted by an image rollback, so
keep them additive.

## Local Docker run

For a local image test, build with
`docker build -f apps/content-cms/Dockerfile -t vantuch-content-cms:local .` and run
it against any PostgreSQL 16 database with `DATABASE_URI`, `PAYLOAD_SECRET`,
`SERVER_URL`, and the S3 variables set.

## Cloudflare configuration

Public hostname `cms.vantuch.dev` → `http://vantuch-content-cms:3000` in the
cloudflared tunnel. Configure Cloudflare Access applications (the most specific
path wins):

| Access application               | Policy                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `cms.vantuch.dev` (whole host)   | Allow: operator identities only. Covers `/admin`, admin REST calls under `/api/*`, and `/api/ingest/docs` + `/api/ingest/openapi.json` |
| `cms.vantuch.dev/api/public`     | **Bypass** (everyone): public API, public OpenAPI, public Swagger                                                                      |
| `cms.vantuch.dev/api/media/file` | **Bypass**: public images (private files still require a CMS login)                                                                    |
| `cms.vantuch.dev/api/health`     | Bypass (no data)                                                                                                                       |

Bots should use the internal `vantuch` network URL, not the public hostname. If a
bot must use the public hostname, give it a Cloudflare **service token** policy on
`/api/ingest/v1` in addition to its CMS bearer credential.

Even without Access, every non-public route enforces Payload authentication.

## RustFS

Create the bucket and a dedicated access key restricted to it in the existing
RustFS instance; do not expose the RustFS console publicly. The bucket stays
private; Payload streams files and enforces media access rules.

## Watcher stack changes

The production Compose file attaches `brno-events-agent` to the `vantuch` network.
Set `CONTENT_CMS_INGEST_TOKEN` (and optionally `CONTENT_CMS_URL`) in the VPS
render inputs and redeploy Watcher normally; without the token, the agent is
unchanged.

## Verification checklist

```bash
curl -fsS https://cms.vantuch.dev/api/health
curl -fsS https://cms.vantuch.dev/api/ready
curl -fsS https://cms.vantuch.dev/api/public/v1/events | jq '.meta'
curl -fsS https://cms.vantuch.dev/api/public/openapi.json | jq '.info'
curl -s -o /dev/null -w '%{http_code}\n' https://cms.vantuch.dev/api/events          # 403 without login
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://cms.vantuch.dev/api/ingest/v1/events   # 401
curl -s -o /dev/null -w '%{http_code}\n' https://cms.vantuch.dev/api/graphql         # 404
# Agent side (on the VPS):
curl -fsS -H "Authorization: Bearer $BRNO_EVENTS_API_TOKEN" http://127.0.0.1:4020/cms/status
```

Then check _Operations → Ingestion Runs_ for a `succeeded` run from
`brno-events-agent`, approve and publish one event, and confirm it appears in
`/api/public/v1/events`.

## Backup and recovery

- **Database:** `content_cms` lives on `watcher-postgres`, but the Watcher
  pre-deployment backup in `deploy.sh` covers only the Watcher database. Run a
  nightly `pg_dump -Fc -d content_cms` (command above) to off-host storage; restore
  with `pg_restore --clean --if-exists -d content_cms`.
- **Media:** back up the RustFS bucket (`content-cms` prefix) with your existing
  RustFS/S3 replication or `mc mirror`.
- **Secrets:** `deploy/runtime/content-cms.env` (mode 0600) is not in git; keep an
  encrypted copy. Rotating `PAYLOAD_SECRET` invalidates sessions only. Bot tokens
  cannot be recovered; issue new ones.
- **Agent outbox:** if the CMS database is restored to an older state, call
  `POST /cms/retry-failed` and, if needed, reset `brno_event_cms_sync` rows to
  `PENDING`; ingestion is idempotent.
