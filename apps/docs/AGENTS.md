<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Documentation contract

- Every change to an application's commands, callbacks, environment variables,
  integrations, upstream sources, scheduling, persistence, safety boundaries,
  or operator-visible behavior must update that application's page under
  `content/docs/bots` in the same change.
- Bot detail pages must keep complete command and environment-variable tables.
  They must also name every implemented external source and every bot or service
  integration, including whether each dependency is required or optional.
- Internal links must use deployed routes such as `/docs/bots/briefing-bot`, not
  source filenames such as `briefing-bot.mdx`.
