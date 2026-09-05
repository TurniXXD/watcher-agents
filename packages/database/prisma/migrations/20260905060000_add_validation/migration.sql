CREATE TYPE "ValidationTargetType" AS ENUM ('THESIS', 'ALERT', 'SIGNAL');

CREATE TABLE "ValidationRun" (
    "id" TEXT NOT NULL,
    "watcherConfigId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "targetCount" INTEGER NOT NULL DEFAULT 0,
    "outcomeCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    CONSTRAINT "ValidationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BacktestOutcome" (
    "id" TEXT NOT NULL,
    "watcherConfigId" TEXT NOT NULL,
    "targetType" "ValidationTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "anchorAt" TIMESTAMP(3) NOT NULL,
    "anchorPrice" DECIMAL(24,8),
    "nextOpenPrice" DECIMAL(24,8),
    "preDetectionReturnPercent" DECIMAL(12,6),
    "returnOneHourPercent" DECIMAL(12,6),
    "returnOneDayPercent" DECIMAL(12,6),
    "returnSevenDayPercent" DECIMAL(12,6),
    "returnThirtyDayPercent" DECIMAL(12,6),
    "returnNinetyDayPercent" DECIMAL(12,6),
    "returnTwelveMonthPercent" DECIMAL(12,6),
    "maximumFavorablePercent" DECIMAL(12,6),
    "maximumAdversePercent" DECIMAL(12,6),
    "verdict" TEXT,
    "sector" TEXT,
    "catalyst" TEXT,
    "signalType" TEXT,
    "signalCombination" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION,
    "attention" INTEGER,
    "marketRegime" TEXT,
    "predictedThirtyDayProbability" DOUBLE PRECISION,
    "completedHorizons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BacktestOutcome_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ValidationRun_watcherConfigId_startedAt_idx" ON "ValidationRun"("watcherConfigId", "startedAt");
CREATE UNIQUE INDEX "BacktestOutcome_watcherConfigId_targetType_targetId_key" ON "BacktestOutcome"("watcherConfigId", "targetType", "targetId");
CREATE INDEX "BacktestOutcome_watcherConfigId_targetType_anchorAt_idx" ON "BacktestOutcome"("watcherConfigId", "targetType", "anchorAt");
CREATE INDEX "BacktestOutcome_ticker_anchorAt_idx" ON "BacktestOutcome"("ticker", "anchorAt");

ALTER TABLE "ValidationRun" ADD CONSTRAINT "ValidationRun_watcherConfigId_fkey" FOREIGN KEY ("watcherConfigId") REFERENCES "WatcherConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BacktestOutcome" ADD CONSTRAINT "BacktestOutcome_watcherConfigId_fkey" FOREIGN KEY ("watcherConfigId") REFERENCES "WatcherConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
