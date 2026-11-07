# Deployment

The CMS is a required `content-cms` service in `docker-compose.production.yml`.
The deploy workflow publishes its image
`ghcr.io/<owner>/vantuch-content-cms:<release sha>` together with the Watcher
image. `deploy/deploy.sh` pulls, starts, health-checks, and rolls it back with
the other required services. It shares the existing Watcher database; media
storage and CMS secrets need one-time operator provisioning.

## Topology

```
Internet ─▶ Cloudflare (DNS + Access) ─▶ cloudflared (vantuch network)
                                            └─▶ vantuch-content-cms:3000  (content-cms container)
                                                     ├─▶ watcher-postgres, Watcher database (default network)
                                                     └─▶ rustfs:9000 (existing, vantuch network)
brno-events-agent (Watcher stack, vantuch network) ─▶ http://vantuch-content-cms:3000/api/ingest/v1
```

The CMS and bots use the same Watcher database on `watcher-postgres`.
Payload and Prisma own distinct tables and migrations; bots send content to
Payload through its authenticated API. The CMS publishes only a loopback fallback
(`127.0.0.1:${CONTENT_CMS_HOST_PORT:-3100}`). RustFS and PostgreSQL consoles must
never be routed through cloudflared.

## One-time provisioning (`/opt/watcher`)

Complete these steps before the next normal Watcher release. The existing
Watcher database is already created by the normal stack; no new database or
role is needed.

1. Create `deploy/runtime/content-cms.env` (mode `0600`) from
   `deploy/presets/content-cms.env.example`: set
   `PAYLOAD_SECRET=$(openssl rand -hex 32)`, `SERVER_URL=https://cms.vantuch.dev`,
   `CORS_ORIGINS`, and the RustFS key. `deploy/render-env.sh` does not manage this
   file. Compose passes the existing Watcher `DATABASE_URL` from
   `deploy/runtime/migrate.env` to CMS; it does not use a separate CMS database
   credential.

```bash
install -m 600 /dev/null deploy/runtime/content-cms.env   # then edit
```

2. Push the release to `main`. The standard deploy pulls the CMS image, backs up
   the shared Watcher database, starts the service, and waits for `/api/ready`.
   Check it with:

```bash
docker compose --env-file deploy/runtime/compose.env --env-file .release.env \
  -f docker-compose.production.yml ps content-cms
curl -fsS http://127.0.0.1:3100/api/ready
```

`.release.env` (written by `deploy.sh`) pins both application images to the
deployed release SHA.

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

Every Watcher release backs up the shared database, pulls the matching CMS image,
and recreates the service. It waits for health and restores the previous image
tag with the other applications if the candidate release fails. The backup is
saved under `backups/pre-deploy-postgres-*.sql.gz`.

For a manual rollback to a previously published tag, use the standard Watcher
rollback procedure. Payload migrations are not reverted by image rollback, so
keep them additive.

To inspect CMS status or startup failures after a release:

```bash
cd /opt/watcher
docker compose --env-file deploy/runtime/compose.env --env-file .release.env \
  -f docker-compose.production.yml ps -a content-cms
docker compose --env-file deploy/runtime/compose.env --env-file .release.env \
  -f docker-compose.production.yml logs --tail 150 content-cms
```

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

- **Database:** Payload tables live in the Watcher database on
  `watcher-postgres` and are included in the standard compressed pre-deployment
  backup. Also back up this database to off-host storage nightly.
- **Media:** back up the RustFS bucket (`content-cms` prefix) with your existing
  RustFS/S3 replication or `mc mirror`.
- **Secrets:** `deploy/runtime/content-cms.env` (mode 0600) is not in git; keep an
  encrypted copy. Rotating `PAYLOAD_SECRET` invalidates sessions only. Bot tokens
  cannot be recovered; issue new ones.
- **Agent outbox:** if the CMS database is restored to an older state, call
  `POST /cms/retry-failed` and, if needed, reset `brno_event_cms_sync` rows to
  `PENDING`; ingestion is idempotent.
