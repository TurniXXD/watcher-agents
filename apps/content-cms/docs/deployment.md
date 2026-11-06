# Deployment

The CMS is deployed independently of the Watcher release (`deploy/deploy.sh` and
the GitHub deploy workflow do **not** build or start it). Nothing deploys
automatically; follow these steps deliberately.

## Topology

```
Internet ─▶ Cloudflare (DNS + Access) ─▶ cloudflared (vantuch network)
                                            └─▶ vantuch-content-cms:3000  (content-cms container)
                                                     ├─▶ content-cms-postgres (private Compose network only)
                                                     └─▶ rustfs:9000 (existing, vantuch network)
brno-events-agent (Watcher stack, vantuch network) ─▶ http://vantuch-content-cms:3000/api/ingest/v1
```

PostgreSQL publishes no ports. The CMS publishes only a loopback fallback
(`127.0.0.1:${CONTENT_CMS_HOST_PORT:-3100}`). RustFS and PostgreSQL consoles must
never be routed through cloudflared.

## First deployment

```bash
cd /opt/watcher                                   # checkout containing apps/content-cms
install -m 600 apps/content-cms/deploy/postgres.env.example apps/content-cms/deploy/postgres.env
install -m 600 apps/content-cms/deploy/content-cms.env.example apps/content-cms/deploy/content-cms.env
# Edit both files: matching password, PAYLOAD_SECRET=$(openssl rand -hex 32), RustFS key, origins.
docker network inspect vantuch >/dev/null        # must already exist
docker compose -f apps/content-cms/docker-compose.yml build
docker compose -f apps/content-cms/docker-compose.yml up -d
docker compose -f apps/content-cms/docker-compose.yml ps
```

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

```bash
git pull
docker compose -f apps/content-cms/docker-compose.yml build content-cms
docker compose -f apps/content-cms/docker-compose.yml exec content-cms-postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/content-cms-$(date +%F-%H%M).dump
docker compose -f apps/content-cms/docker-compose.yml up -d content-cms
```

To roll back, re-tag/build the previous commit's image and `up -d` again.
Migrations are not reverted by an image rollback, so keep them additive.
To use a registry image instead of building on the server, set
`CONTENT_CMS_IMAGE=ghcr.io/<owner>/vantuch-content-cms:<sha>`.

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

- **Database:** nightly `pg_dump -Fc` of `content_cms` (command above) to off-host
  storage; restore with `pg_restore --clean --if-exists -d content_cms`.
  Volume: `vantuch-content_content-cms-postgres`.
- **Media:** back up the RustFS bucket (`content-cms` prefix) with your existing
  RustFS/S3 replication or `mc mirror`.
- **Secrets:** `apps/content-cms/deploy/*.env` (mode 0600) are not in git; keep an
  encrypted copy. Rotating `PAYLOAD_SECRET` invalidates sessions only. Bot tokens
  cannot be recovered; issue new ones.
- **Agent outbox:** if the CMS database is restored to an older state, call
  `POST /cms/retry-failed` and, if needed, reset `brno_event_cms_sync` rows to
  `PENDING`; ingestion is idempotent.
