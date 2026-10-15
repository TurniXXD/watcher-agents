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

The canonical production URL defaults to `https://docs.vantuch.dev`. Override it
at build time with `NEXT_PUBLIC_DOCS_URL` when using another hostname.

## Deployment

The shared Watcher image contains the standalone Next.js server and Compose runs
it as the `docs` service. The default addresses are:

- VPS loopback: `http://127.0.0.1:3001`
- Compose origin: `http://docs:3000`
- Cloudflare hostname: `https://docs.vantuch.dev`

The production service joins the external `lateralis` network used by the
existing token-managed `cloudflared` container. In Cloudflare Zero Trust, map
`docs.vantuch.dev` to `http://docs:3000`. The tunnel configuration and token are
not stored in this repository.

Enable Cloudflare Access before exposing the hostname. This repository emits
`noindex` metadata and a deny-all `robots.txt`, but those controls are not
authentication. Keep `DOCS_BIND_ADDRESS=127.0.0.1` unless direct network access
is explicitly required.

The website must remain private unless publication is explicitly approved. Do
not put runtime bot secrets into the docs project.
