# Vantuch Content Hub (Payload CMS) production image.
# Build from the repository root so the shared pnpm lockfile is used:
#   docker build -f apps/content-cms/Dockerfile -t vantuch-content-cms:local .
# The context is restricted by apps/content-cms/Dockerfile.dockerignore.
FROM node:26.13.0-bookworm AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@11.6.0
WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/content-cms/package.json apps/content-cms/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @watcher/content-cms...

FROM dependencies AS build

COPY apps/content-cms apps/content-cms
# `next build` needs no database or secrets (see src/env.ts build placeholders).
RUN NODE_ENV=production pnpm --filter @watcher/content-cms build

FROM node:26.13.0-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app

COPY --from=build --chown=node:node /app/apps/content-cms/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/content-cms/.next/static ./apps/content-cms/.next/static

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/content-cms/server.js"]
