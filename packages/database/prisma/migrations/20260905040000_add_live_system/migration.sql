CREATE TYPE "StockAlertType" AS ENUM ('HIGH_PRIORITY', 'THESIS_CHANGE', 'VERDICT_CHANGE', 'EXTREME_CATALYST', 'INSIDER_CLUSTER', 'UNEXPLAINED_ACTIVITY', 'ASYMMETRY_CHANGE');
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'MEDIUM', 'HIGH', 'EXTREME');

ALTER TABLE "WatcherConfig"
ADD COLUMN "reconciliationInProgress" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "reconciliationStartedAt" TIMESTAMP(3),
ADD COLUMN "lastReconciliationAt" TIMESTAMP(3),
ADD COLUMN "nextReconciliationAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Analysis"
ADD COLUMN "durationMs" INTEGER,
ADD COLUMN "llmCallCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "promptTokens" INTEGER,
ADD COLUMN "completionTokens" INTEGER,
ADD COLUMN "estimatedCostUsd" DECIMAL(18,8) NOT NULL DEFAULT 0;

CREATE TABLE "StockAlert" (
    "id" TEXT NOT NULL,
    "watcherConfigId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "type" "StockAlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "eventDetectedAt" TIMESTAMP(3) NOT NULL,
    "analysisCompletedAt" TIMESTAMP(3) NOT NULL,
    "deliveryClaimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
    "deliveryError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WatcherConfig_enabled_nextReconciliationAt_idx" ON "WatcherConfig"("enabled", "nextReconciliationAt");
CREATE UNIQUE INDEX "StockAlert_watcherConfigId_eventId_key" ON "StockAlert"("watcherConfigId", "eventId");
CREATE INDEX "StockAlert_watcherConfigId_sentAt_createdAt_idx" ON "StockAlert"("watcherConfigId", "sentAt", "createdAt");
CREATE INDEX "StockAlert_runId_sentAt_idx" ON "StockAlert"("runId", "sentAt");
CREATE INDEX "StockAlert_severity_createdAt_idx" ON "StockAlert"("severity", "createdAt");

ALTER TABLE "StockAlert" ADD CONSTRAINT "StockAlert_watcherConfigId_fkey" FOREIGN KEY ("watcherConfigId") REFERENCES "WatcherConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockAlert" ADD CONSTRAINT "StockAlert_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WatcherRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockAlert" ADD CONSTRAINT "StockAlert_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CanonicalEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
