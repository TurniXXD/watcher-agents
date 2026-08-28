CREATE TYPE "WatcherKind" AS ENUM ('STOCKS', 'PUBLICATIONS');
CREATE TYPE "RunTrigger" AS ENUM ('MANUAL', 'SCHEDULED');
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED');
CREATE TYPE "AnalysisStatus" AS ENUM ('SUCCESS', 'FAILED');
CREATE TYPE "StockSourceType" AS ENUM ('SEC', 'INVESTOR_RELATIONS', 'NEWS', 'PRICE');
CREATE TYPE "PublicationSourceType" AS ENUM ('PUBMED', 'BIORXIV', 'CLINICAL_TRIALS', 'FDA');

CREATE TABLE "TelegramChat" (
  "id" TEXT NOT NULL,
  "kind" "WatcherKind" NOT NULL,
  "chatId" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramChat_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WatcherConfig" (
  "id" TEXT NOT NULL,
  "chatConfigId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "schedule" TEXT NOT NULL DEFAULT '0 8 * * *',
  "timezone" TEXT NOT NULL DEFAULT 'Europe/Prague',
  "lastRunAt" TIMESTAMP(3),
  "nextRunAt" TIMESTAMP(3),
  "lastRunStatus" "RunStatus",
  "runInProgress" BOOLEAN NOT NULL DEFAULT false,
  "runStartedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WatcherConfig_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WatcherRun" (
  "id" TEXT NOT NULL,
  "watcherConfigId" TEXT NOT NULL,
  "trigger" "RunTrigger" NOT NULL,
  "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "fetchedCount" INTEGER NOT NULL DEFAULT 0,
  "newItemCount" INTEGER NOT NULL DEFAULT 0,
  "analyzedCount" INTEGER NOT NULL DEFAULT 0,
  "failedAnalysisCount" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  CONSTRAINT "WatcherRun_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SourceFailure" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceFailure_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProcessedItem" (
  "id" TEXT NOT NULL,
  "watcherKind" "WatcherKind" NOT NULL,
  "source" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "contentHash" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcessedItem_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Analysis" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "processedItemId" TEXT NOT NULL,
  "status" "AnalysisStatus" NOT NULL,
  "result" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Stock" (
  "id" TEXT NOT NULL,
  "chatConfigId" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "companyName" TEXT,
  "cik" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Stock_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StockSourceConfig" (
  "id" TEXT NOT NULL,
  "stockId" TEXT NOT NULL,
  "source" "StockSourceType" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "config" JSONB,
  CONSTRAINT "StockSourceConfig_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PublicationQuery" (
  "id" TEXT NOT NULL,
  "chatConfigId" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "normalizedQuery" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicationQuery_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PublicationSourceConfig" (
  "id" TEXT NOT NULL,
  "queryId" TEXT NOT NULL,
  "source" "PublicationSourceType" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "config" JSONB,
  CONSTRAINT "PublicationSourceConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramChat_kind_chatId_key" ON "TelegramChat"("kind", "chatId");
CREATE UNIQUE INDEX "WatcherConfig_chatConfigId_key" ON "WatcherConfig"("chatConfigId");
CREATE INDEX "WatcherConfig_enabled_nextRunAt_idx" ON "WatcherConfig"("enabled", "nextRunAt");
CREATE INDEX "WatcherRun_watcherConfigId_startedAt_idx" ON "WatcherRun"("watcherConfigId", "startedAt");
CREATE INDEX "SourceFailure_runId_idx" ON "SourceFailure"("runId");
CREATE INDEX "ProcessedItem_watcherKind_contentHash_idx" ON "ProcessedItem"("watcherKind", "contentHash");
CREATE INDEX "ProcessedItem_url_idx" ON "ProcessedItem"("url");
CREATE UNIQUE INDEX "ProcessedItem_watcherKind_source_externalId_key" ON "ProcessedItem"("watcherKind", "source", "externalId");
CREATE INDEX "Analysis_processedItemId_idx" ON "Analysis"("processedItemId");
CREATE UNIQUE INDEX "Analysis_runId_processedItemId_key" ON "Analysis"("runId", "processedItemId");
CREATE UNIQUE INDEX "Stock_chatConfigId_symbol_key" ON "Stock"("chatConfigId", "symbol");
CREATE UNIQUE INDEX "StockSourceConfig_stockId_source_key" ON "StockSourceConfig"("stockId", "source");
CREATE UNIQUE INDEX "PublicationQuery_chatConfigId_normalizedQuery_key" ON "PublicationQuery"("chatConfigId", "normalizedQuery");
CREATE UNIQUE INDEX "PublicationSourceConfig_queryId_source_key" ON "PublicationSourceConfig"("queryId", "source");

ALTER TABLE "WatcherConfig" ADD CONSTRAINT "WatcherConfig_chatConfigId_fkey" FOREIGN KEY ("chatConfigId") REFERENCES "TelegramChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WatcherRun" ADD CONSTRAINT "WatcherRun_watcherConfigId_fkey" FOREIGN KEY ("watcherConfigId") REFERENCES "WatcherConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceFailure" ADD CONSTRAINT "SourceFailure_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WatcherRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WatcherRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_processedItemId_fkey" FOREIGN KEY ("processedItemId") REFERENCES "ProcessedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_chatConfigId_fkey" FOREIGN KEY ("chatConfigId") REFERENCES "TelegramChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockSourceConfig" ADD CONSTRAINT "StockSourceConfig_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicationQuery" ADD CONSTRAINT "PublicationQuery_chatConfigId_fkey" FOREIGN KEY ("chatConfigId") REFERENCES "TelegramChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicationSourceConfig" ADD CONSTRAINT "PublicationSourceConfig_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "PublicationQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
