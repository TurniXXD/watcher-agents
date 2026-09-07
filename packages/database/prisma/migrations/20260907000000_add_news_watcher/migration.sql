ALTER TYPE "WatcherKind" ADD VALUE 'NEWS';
ALTER TYPE "BriefingWatcherBot" ADD VALUE 'NEWS';

CREATE TYPE "NewsScope" AS ENUM ('CZECH', 'GLOBAL');

CREATE TABLE "NewsFeed" (
    "id" TEXT NOT NULL,
    "chatConfigId" TEXT NOT NULL,
    "scope" "NewsScope" NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NewsFeed_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NewsTopic" (
    "id" TEXT NOT NULL,
    "chatConfigId" TEXT NOT NULL,
    "scope" "NewsScope" NOT NULL,
    "topic" TEXT NOT NULL,
    "normalizedTopic" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NewsTopic_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NewsFeed_chatConfigId_scope_url_key" ON "NewsFeed"("chatConfigId", "scope", "url");
CREATE INDEX "NewsFeed_chatConfigId_scope_enabled_idx" ON "NewsFeed"("chatConfigId", "scope", "enabled");
CREATE UNIQUE INDEX "NewsTopic_chatConfigId_scope_normalizedTopic_key" ON "NewsTopic"("chatConfigId", "scope", "normalizedTopic");
CREATE INDEX "NewsTopic_chatConfigId_scope_idx" ON "NewsTopic"("chatConfigId", "scope");

ALTER TABLE "NewsFeed" ADD CONSTRAINT "NewsFeed_chatConfigId_fkey" FOREIGN KEY ("chatConfigId") REFERENCES "TelegramChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsTopic" ADD CONSTRAINT "NewsTopic_chatConfigId_fkey" FOREIGN KEY ("chatConfigId") REFERENCES "TelegramChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
