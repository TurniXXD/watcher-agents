FROM node:24.14.0-alpine AS base

ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/corepack
ENV PATH=$PNPM_HOME:$PATH

RUN apk add --no-cache openssl \
    && corepack enable \
    && corepack prepare pnpm@11.6.0 --activate
WORKDIR /app

FROM base AS manifests

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/publications-bot/package.json apps/publications-bot/package.json
COPY apps/stocks-bot/package.json apps/stocks-bot/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/llm/package.json packages/llm/package.json
COPY packages/publication-sources/package.json packages/publication-sources/package.json
COPY packages/stock-sources/package.json packages/stock-sources/package.json
COPY packages/telegram/package.json packages/telegram/package.json

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

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/apps/publications-bot/node_modules ./apps/publications-bot/node_modules
COPY --from=production-dependencies --chown=node:node /app/apps/stocks-bot/node_modules ./apps/stocks-bot/node_modules
COPY --from=production-dependencies --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /app/apps/publications-bot/package.json ./apps/publications-bot/package.json
COPY --from=build --chown=node:node /app/apps/publications-bot/dist ./apps/publications-bot/dist
COPY --from=build --chown=node:node /app/apps/stocks-bot/package.json ./apps/stocks-bot/package.json
COPY --from=build --chown=node:node /app/apps/stocks-bot/dist ./apps/stocks-bot/dist
COPY --from=build --chown=node:node /app/packages/core/dist ./packages/core/dist
COPY --from=build --chown=node:node /app/packages/database/dist ./packages/database/dist
COPY --from=build --chown=node:node /app/packages/database/prisma ./packages/database/prisma
COPY --from=build --chown=node:node /app/packages/database/prisma.config.ts ./packages/database/prisma.config.ts
COPY --from=build --chown=node:node /app/packages/llm/dist ./packages/llm/dist
COPY --from=build --chown=node:node /app/packages/publication-sources/dist ./packages/publication-sources/dist
COPY --from=build --chown=node:node /app/packages/stock-sources/dist ./packages/stock-sources/dist
COPY --from=build --chown=node:node /app/packages/telegram/dist ./packages/telegram/dist

USER node

CMD ["node", "apps/stocks-bot/dist/index.js"]
