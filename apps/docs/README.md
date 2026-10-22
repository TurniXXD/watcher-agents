# Watcher Documentation

Versioned Fumadocs application for Watcher architecture, application,
integration, configuration, and operations documentation. Content is stored as
local MDX under `content/docs`; it has no CMS or runtime dependency on the bots.

## Development

From the repository root:

```bash
pnpm docs:dev
pnpm docs:build
pnpm --filter @watcher/docs typecheck
pnpm --filter @watcher/docs check:links
```

The canonical production URL defaults to `https://bots.vantuch.dev`. Override it
at build time with `NEXT_PUBLIC_DOCS_URL` when using another hostname.

## Deployment

The shared Watcher image contains the standalone Next.js server and Compose runs
it as the `docs` service. The addresses are:

- Local development Compose: `http://127.0.0.1:3001`
- Compose origin: `http://docs:3000`
- Cloudflare hostname: `https://bots.vantuch.dev`

The production service joins the external `vantuch` network used by the
existing token-managed `cloudflared` container. In Cloudflare Zero Trust, map
`bots.vantuch.dev` to `http://docs:3000`. The tunnel configuration and token are
not stored in this repository.

The operator has approved public documentation at this hostname. For public
reading, do not require a Cloudflare Access login on `bots.vantuch.dev`; keep
Access protection on other private applications such as Twenty. This repository emits
`noindex` metadata and a deny-all `robots.txt`, but those controls are not
authentication. Production intentionally publishes no host port; only local
development Compose uses `DOCS_BIND_ADDRESS` and `DOCS_HOST_PORT`.

See the [VPS tunnel setup](../../deploy/README.md#cloudflare-tunnel-origins)
for the `vantuch server` connector, Docker network migration, and DNS steps.
Do not put runtime bot secrets or private operator data into the docs project.
