ALTER TYPE "StockSourceType" ADD VALUE 'QUIVER_INSIDERS';
ALTER TYPE "StockSourceType" ADD VALUE 'QUIVER_CONTRACTS';
ALTER TYPE "StockSourceType" ADD VALUE 'QUIVER_PATENTS';
ALTER TYPE "StockSourceType" ADD VALUE 'QUIVER_CONGRESS';
ALTER TYPE "StockSourceType" ADD VALUE 'QUIVER_OFF_EXCHANGE';

CREATE TYPE "InsiderTransactionType" AS ENUM (
  'OPEN_MARKET_BUY',
  'OPEN_MARKET_SELL',
  'TEN_B5_1_SALE',
  'TAX_SELL_TO_COVER',
  'OPTION_EXERCISE',
  'RSU_VESTING',
  'GIFT',
  'OTHER'
);
CREATE TYPE "CatalystType" AS ENUM (
  'EARNINGS',
  'CLINICAL_RESULTS',
  'FDA_DECISION',
  'PRODUCT_LAUNCH',
  'COURT_DECISION',
  'INVESTOR_DAY',
  'CONTRACT',
  'GUIDANCE',
  'PATENT_EXPIRATION',
  'REGULATORY_DECISION'
);
CREATE TYPE "CatalystProximity" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'IMMINENT');
CREATE TYPE "CatalystDirection" AS ENUM ('POSITIVE', 'NEGATIVE', 'BINARY', 'UNKNOWN');
CREATE TYPE "CatalystStatus" AS ENUM ('UPCOMING', 'ACTIVE', 'COMPLETED', 'CANCELLED');

CREATE TABLE "InsiderSignal" (
  "id" TEXT NOT NULL,
  "processedItemId" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "insider" TEXT NOT NULL,
  "role" TEXT,
  "transactionType" "InsiderTransactionType" NOT NULL,
  "occurredAt" TIMESTAMP(3),
  "shares" DECIMAL(24,4),
  "price" DECIMAL(24,8),
  "transactionValue" DECIMAL(24,2),
  "holdingsBefore" DECIMAL(24,4),
  "holdingsAfter" DECIMAL(24,4),
  "holdingsChangePercent" DECIMAL(12,6),
  "planned" BOOLEAN NOT NULL DEFAULT false,
  "discretionary" BOOLEAN NOT NULL DEFAULT false,
  "convictionScore" INTEGER NOT NULL,
  "clusterSize" INTEGER NOT NULL DEFAULT 1,
  "rationale" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InsiderSignal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketSnapshot" (
  "id" TEXT NOT NULL,
  "processedItemId" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "open" DECIMAL(24,8) NOT NULL,
  "high" DECIMAL(24,8) NOT NULL,
  "low" DECIMAL(24,8) NOT NULL,
  "close" DECIMAL(24,8) NOT NULL,
  "volume" BIGINT NOT NULL,
  "dailyReturnPercent" DECIMAL(12,6),
  "weeklyReturnPercent" DECIMAL(12,6),
  "monthlyReturnPercent" DECIMAL(12,6),
  "ninetyDayReturnPercent" DECIMAL(12,6),
  "relativeVolume" DECIMAL(12,6),
  "gapPercent" DECIMAL(12,6),
  "atrPercent" DECIMAL(12,6),
  "realizedVolatilityPercent" DECIMAL(12,6),
  "movingAverage20DistancePercent" DECIMAL(12,6),
  "rsi14" DECIMAL(12,6),
  "preMarketChangePercent" DECIMAL(12,6),
  "afterHoursChangePercent" DECIMAL(12,6),
  "relativeSectorPercent" DECIMAL(12,6),
  "relativeIndexPercent" DECIMAL(12,6),
  "priceAnomaly" BOOLEAN NOT NULL DEFAULT false,
  "volumeAnomaly" BOOLEAN NOT NULL DEFAULT false,
  "gapAnomaly" BOOLEAN NOT NULL DEFAULT false,
  "volatilityExpansion" BOOLEAN NOT NULL DEFAULT false,
  "unexplained" BOOLEAN NOT NULL DEFAULT false,
  "primaryDriverId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OffExchangeSnapshot" (
  "id" TEXT NOT NULL,
  "processedItemId" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "shortVolume" BIGINT NOT NULL,
  "totalVolume" BIGINT NOT NULL,
  "dpi" DECIMAL(12,6) NOT NULL,
  "baselineDpi" DECIMAL(12,6),
  "relativeDpi" DECIMAL(12,6),
  "anomaly" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OffExchangeSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Catalyst" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "catalystType" "CatalystType" NOT NULL,
  "description" TEXT NOT NULL,
  "expectedStart" TIMESTAMP(3),
  "expectedEnd" TIMESTAMP(3),
  "exactDateKnown" BOOLEAN NOT NULL DEFAULT false,
  "proximity" "CatalystProximity" NOT NULL,
  "impact" "Materiality" NOT NULL,
  "direction" "CatalystDirection" NOT NULL,
  "status" "CatalystStatus" NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Catalyst_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InsiderSignal_processedItemId_key" ON "InsiderSignal"("processedItemId");
CREATE INDEX "InsiderSignal_ticker_transactionType_occurredAt_idx" ON "InsiderSignal"("ticker", "transactionType", "occurredAt");
CREATE INDEX "InsiderSignal_ticker_convictionScore_idx" ON "InsiderSignal"("ticker", "convictionScore");
CREATE UNIQUE INDEX "MarketSnapshot_processedItemId_key" ON "MarketSnapshot"("processedItemId");
CREATE INDEX "MarketSnapshot_ticker_observedAt_idx" ON "MarketSnapshot"("ticker", "observedAt");
CREATE INDEX "MarketSnapshot_ticker_unexplained_observedAt_idx" ON "MarketSnapshot"("ticker", "unexplained", "observedAt");
CREATE UNIQUE INDEX "OffExchangeSnapshot_processedItemId_key" ON "OffExchangeSnapshot"("processedItemId");
CREATE INDEX "OffExchangeSnapshot_ticker_observedAt_idx" ON "OffExchangeSnapshot"("ticker", "observedAt");
CREATE UNIQUE INDEX "Catalyst_fingerprint_key" ON "Catalyst"("fingerprint");
CREATE INDEX "Catalyst_ticker_status_expectedStart_idx" ON "Catalyst"("ticker", "status", "expectedStart");
CREATE INDEX "Catalyst_proximity_impact_idx" ON "Catalyst"("proximity", "impact");

ALTER TABLE "InsiderSignal" ADD CONSTRAINT "InsiderSignal_processedItemId_fkey"
  FOREIGN KEY ("processedItemId") REFERENCES "ProcessedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketSnapshot" ADD CONSTRAINT "MarketSnapshot_processedItemId_fkey"
  FOREIGN KEY ("processedItemId") REFERENCES "ProcessedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OffExchangeSnapshot" ADD CONSTRAINT "OffExchangeSnapshot_processedItemId_fkey"
  FOREIGN KEY ("processedItemId") REFERENCES "ProcessedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Catalyst" ADD CONSTRAINT "Catalyst_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "CanonicalEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
