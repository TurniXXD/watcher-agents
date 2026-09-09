FROM node:24.14.0-bookworm AS base

ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/corepack
ENV PATH=$PNPM_HOME:$PATH

RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g; s|http://security.debian.org|https://security.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@11.6.0 --activate
WORKDIR /app

FROM base AS manifests

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/brno-events-agent/package.json apps/brno-events-agent/package.json
COPY apps/briefing-bot/package.json apps/briefing-bot/package.json
COPY apps/mu-clubs-monitor/package.json apps/mu-clubs-monitor/package.json
COPY apps/maintenance-agent/package.json apps/maintenance-agent/package.json
COPY apps/news-bot/package.json apps/news-bot/package.json
COPY apps/publications-bot/package.json apps/publications-bot/package.json
COPY apps/stocks-bot/package.json apps/stocks-bot/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/sources/package.json packages/sources/package.json
COPY packages/llm/package.json packages/llm/package.json
COPY packages/telegram/package.json packages/telegram/package.json
COPY packages/observability/package.json packages/observability/package.json

FROM manifests AS dependencies

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . .
RUN DATABASE_URL=postgresql://watcher:watcher@postgres:5432/watcher pnpm db:generate
RUN pnpm build

FROM manifests AS production-dependencies

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

FROM base AS runtime

ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip \
    && python3 -m pip install --break-system-packages --no-cache-dir piper-tts==1.4.2 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/apps/brno-events-agent/node_modules ./apps/brno-events-agent/node_modules
COPY --from=production-dependencies --chown=node:node /app/apps/briefing-bot/node_modules ./apps/briefing-bot/node_modules
COPY --from=production-dependencies --chown=node:node /app/apps/mu-clubs-monitor/node_modules ./apps/mu-clubs-monitor/node_modules
COPY --from=production-dependencies --chown=node:node /app/apps/maintenance-agent/node_modules ./apps/maintenance-agent/node_modules
COPY --from=production-dependencies --chown=node:node /app/apps/news-bot/node_modules ./apps/news-bot/node_modules
COPY --from=production-dependencies --chown=node:node /app/apps/publications-bot/node_modules ./apps/publications-bot/node_modules
COPY --from=production-dependencies --chown=node:node /app/apps/stocks-bot/node_modules ./apps/stocks-bot/node_modules
COPY --from=production-dependencies --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /app/apps/brno-events-agent/package.json ./apps/brno-events-agent/package.json
COPY --from=build --chown=node:node /app/apps/brno-events-agent/dist ./apps/brno-events-agent/dist
COPY --from=build --chown=node:node /app/apps/briefing-bot/package.json ./apps/briefing-bot/package.json
COPY --from=build --chown=node:node /app/apps/briefing-bot/dist ./apps/briefing-bot/dist
COPY --from=build --chown=node:node /app/apps/mu-clubs-monitor/package.json ./apps/mu-clubs-monitor/package.json
COPY --from=build --chown=node:node /app/apps/mu-clubs-monitor/dist ./apps/mu-clubs-monitor/dist
COPY --from=build --chown=node:node /app/apps/maintenance-agent/package.json ./apps/maintenance-agent/package.json
COPY --from=build --chown=node:node /app/apps/maintenance-agent/dist ./apps/maintenance-agent/dist
COPY --from=build --chown=node:node /app/apps/news-bot/package.json ./apps/news-bot/package.json
COPY --from=build --chown=node:node /app/apps/news-bot/dist ./apps/news-bot/dist
COPY --from=build --chown=node:node /app/apps/publications-bot/package.json ./apps/publications-bot/package.json
COPY --from=build --chown=node:node /app/apps/publications-bot/dist ./apps/publications-bot/dist
COPY --from=build --chown=node:node /app/apps/stocks-bot/package.json ./apps/stocks-bot/package.json
COPY --from=build --chown=node:node /app/apps/stocks-bot/dist ./apps/stocks-bot/dist
COPY --from=build --chown=node:node /app/packages/core/dist ./packages/core/dist
COPY --from=build --chown=node:node /app/packages/database/dist ./packages/database/dist
COPY --from=build --chown=node:node /app/packages/database/prisma ./packages/database/prisma
COPY --from=build --chown=node:node /app/packages/database/prisma.config.ts ./packages/database/prisma.config.ts
COPY --from=build --chown=node:node /app/packages/sources/dist ./packages/sources/dist
COPY --from=build --chown=node:node /app/packages/llm/dist ./packages/llm/dist
COPY --from=build --chown=node:node /app/packages/telegram/dist ./packages/telegram/dist
COPY --from=build --chown=node:node /app/packages/observability/dist ./packages/observability/dist
COPY --from=build --chown=node:node /app/docs/maintenance-changelog.md ./docs/maintenance-changelog.md

USER node

CMD ["node", "apps/stocks-bot/dist/index.js"]
