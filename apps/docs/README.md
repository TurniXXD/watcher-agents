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

The production URL defaults to `https://docs.vantuch.dev`. Override it at build
time with `NEXT_PUBLIC_DOCS_URL` when previewing another deployment.

## Deployment

Import the repository into Vercel, set the Root Directory to `apps/docs`, and
enable Vercel Deployment Protection before attaching the production domain.
This repository intentionally emits `noindex` metadata and a deny-all
`robots.txt`; those controls discourage indexing but are not authentication.

The website must remain private unless publication is explicitly approved. Do
not put runtime bot secrets into the docs project.
