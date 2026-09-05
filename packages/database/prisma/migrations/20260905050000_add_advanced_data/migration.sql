ALTER TYPE "StockSourceType" ADD VALUE 'QUIVER_LOBBYING';
ALTER TYPE "StockSourceType" ADD VALUE 'ALPHA_VANTAGE_OPTIONS';
ALTER TYPE "StockSourceType" ADD VALUE 'ALPHA_VANTAGE_INSTITUTIONAL';
ALTER TYPE "StockSourceType" ADD VALUE 'FINRA_SHORT_INTEREST';
ALTER TYPE "StockSourceType" ADD VALUE 'CLINICAL_TRIALS';
ALTER TYPE "StockSourceType" ADD VALUE 'FDA';
ALTER TYPE "CanonicalEventType" ADD VALUE 'SHORT_INTEREST_CHANGE';

CREATE TABLE "OptionsSnapshot" (
    "id" TEXT NOT NULL,
    "processedItemId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "callVolume" BIGINT NOT NULL,
    "putVolume" BIGINT NOT NULL,
    "callOpenInterest" BIGINT NOT NULL,
    "putOpenInterest" BIGINT NOT NULL,
    "putCallVolumeRatio" DECIMAL(12,6),
    "putCallOpenInterestRatio" DECIMAL(12,6),
    "meanImpliedVolatility" DECIMAL(12,6),
    "maxVolumeOiRatio" DECIMAL(12,6),
    "anomaly" BOOLEAN NOT NULL DEFAULT false,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OptionsSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InstitutionalSnapshot" (
    "id" TEXT NOT NULL,
    "processedItemId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL,
    "totalShares" DECIMAL(30,4),
    "totalValueUsd" DECIMAL(30,2),
    "netShareChange" DECIMAL(30,4),
    "changePercent" DECIMAL(12,6),
    "holderCount" INTEGER,
    "topHolders" JSONB NOT NULL DEFAULT '[]',
    "materialChange" BOOLEAN NOT NULL DEFAULT false,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstitutionalSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShortInterestSnapshot" (
    "id" TEXT NOT NULL,
    "processedItemId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "settlementDate" TIMESTAMP(3) NOT NULL,
    "currentShortPosition" BIGINT NOT NULL,
    "previousShortPosition" BIGINT,
    "changeShares" BIGINT,
    "changePercent" DECIMAL(12,6),
    "averageDailyVolume" BIGINT,
    "daysToCover" DECIMAL(12,6),
    "materialChange" BOOLEAN NOT NULL DEFAULT false,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShortInterestSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OptionsSnapshot_processedItemId_key" ON "OptionsSnapshot"("processedItemId");
CREATE INDEX "OptionsSnapshot_ticker_observedAt_idx" ON "OptionsSnapshot"("ticker", "observedAt");
CREATE INDEX "OptionsSnapshot_ticker_anomaly_observedAt_idx" ON "OptionsSnapshot"("ticker", "anomaly", "observedAt");
CREATE UNIQUE INDEX "InstitutionalSnapshot_processedItemId_key" ON "InstitutionalSnapshot"("processedItemId");
CREATE INDEX "InstitutionalSnapshot_ticker_reportedAt_idx" ON "InstitutionalSnapshot"("ticker", "reportedAt");
CREATE INDEX "InstitutionalSnapshot_ticker_materialChange_reportedAt_idx" ON "InstitutionalSnapshot"("ticker", "materialChange", "reportedAt");
CREATE UNIQUE INDEX "ShortInterestSnapshot_processedItemId_key" ON "ShortInterestSnapshot"("processedItemId");
CREATE INDEX "ShortInterestSnapshot_ticker_settlementDate_idx" ON "ShortInterestSnapshot"("ticker", "settlementDate");
CREATE INDEX "ShortInterestSnapshot_ticker_materialChange_settlementDate_idx" ON "ShortInterestSnapshot"("ticker", "materialChange", "settlementDate");

ALTER TABLE "OptionsSnapshot" ADD CONSTRAINT "OptionsSnapshot_processedItemId_fkey" FOREIGN KEY ("processedItemId") REFERENCES "ProcessedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InstitutionalSnapshot" ADD CONSTRAINT "InstitutionalSnapshot_processedItemId_fkey" FOREIGN KEY ("processedItemId") REFERENCES "ProcessedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShortInterestSnapshot" ADD CONSTRAINT "ShortInterestSnapshot_processedItemId_fkey" FOREIGN KEY ("processedItemId") REFERENCES "ProcessedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
