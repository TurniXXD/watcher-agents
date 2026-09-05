CREATE TYPE "DiscoverySignalStatus" AS ENUM ('OBSERVED', 'INVESTIGATING', 'PROMOTED', 'EXPIRED');
CREATE TYPE "DiscoveryScanMode" AS ENUM ('DAILY', 'INTRADAY');
CREATE TYPE "DiscoveryTrigger" AS ENUM ('PRICE_MOVE', 'MOST_ACTIVE');

ALTER TABLE "WatcherConfig"
  ADD COLUMN "discoveryScanInProgress" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "discoveryScanStartedAt" TIMESTAMP(3),
  ADD COLUMN "lastDiscoveryScanAt" TIMESTAMP(3),
  ADD COLUMN "nextDiscoveryScanAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Stock"
  ADD COLUMN "autoDiscovered" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "attentionScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "investigationStartedAt" TIMESTAMP(3),
  ADD COLUMN "investigateUntil" TIMESTAMP(3),
  ADD COLUMN "highResolutionUntil" TIMESTAMP(3),
  ADD COLUMN "lastDiscoverySignalAt" TIMESTAMP(3),
  ADD COLUMN "nextHighResolutionCheckAt" TIMESTAMP(3),
  ADD COLUMN "lastHighResolutionCheckAt" TIMESTAMP(3);
ALTER TABLE "Stock" ADD COLUMN "watchStartedAt" TIMESTAMP(3);

CREATE TABLE "DiscoveryScan" (
  "id" TEXT NOT NULL,
  "watcherConfigId" TEXT NOT NULL,
  "trigger" "RunTrigger" NOT NULL,
  "mode" "DiscoveryScanMode" NOT NULL,
  "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
  "observedCount" INTEGER NOT NULL DEFAULT 0,
  "candidateCount" INTEGER NOT NULL DEFAULT 0,
  "activatedCount" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "DiscoveryScan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscoverySignal" (
  "id" TEXT NOT NULL,
  "watcherConfigId" TEXT NOT NULL,
  "scanId" TEXT NOT NULL,
  "stockId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "trigger" "DiscoveryTrigger" NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "price" DECIMAL(24,8) NOT NULL,
  "changePercent" DECIMAL(12,6) NOT NULL,
  "volume" BIGINT NOT NULL,
  "dollarVolume" DECIMAL(24,2) NOT NULL,
  "attentionScore" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "DiscoverySignalStatus" NOT NULL DEFAULT 'INVESTIGATING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscoverySignal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WatcherConfig_enabled_nextDiscoveryScanAt_idx" ON "WatcherConfig"("enabled", "nextDiscoveryScanAt");
CREATE INDEX "Stock_monitoringMode_nextHighResolutionCheckAt_idx" ON "Stock"("monitoringMode", "nextHighResolutionCheckAt");
CREATE INDEX "DiscoveryScan_watcherConfigId_startedAt_idx" ON "DiscoveryScan"("watcherConfigId", "startedAt");
CREATE UNIQUE INDEX "DiscoverySignal_watcherConfigId_fingerprint_key" ON "DiscoverySignal"("watcherConfigId", "fingerprint");
CREATE INDEX "DiscoverySignal_watcherConfigId_status_observedAt_idx" ON "DiscoverySignal"("watcherConfigId", "status", "observedAt");
CREATE INDEX "DiscoverySignal_stockId_observedAt_idx" ON "DiscoverySignal"("stockId", "observedAt");

ALTER TABLE "DiscoveryScan" ADD CONSTRAINT "DiscoveryScan_watcherConfigId_fkey"
  FOREIGN KEY ("watcherConfigId") REFERENCES "WatcherConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoverySignal" ADD CONSTRAINT "DiscoverySignal_watcherConfigId_fkey"
  FOREIGN KEY ("watcherConfigId") REFERENCES "WatcherConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoverySignal" ADD CONSTRAINT "DiscoverySignal_scanId_fkey"
  FOREIGN KEY ("scanId") REFERENCES "DiscoveryScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoverySignal" ADD CONSTRAINT "DiscoverySignal_stockId_fkey"
  FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
