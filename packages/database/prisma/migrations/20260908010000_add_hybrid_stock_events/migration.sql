-- Extend the existing canonical stock-event model without replacing or losing
-- any article/evidence records. PostgreSQL's existing pgvector extension is
-- intentionally reused; it is established by the briefing migration.
ALTER TYPE "CanonicalEventType" ADD VALUE IF NOT EXISTS 'MERGER';
ALTER TYPE "CanonicalEventType" ADD VALUE IF NOT EXISTS 'FINANCING';
ALTER TYPE "CanonicalEventType" ADD VALUE IF NOT EXISTS 'CAPITAL_RETURN';
ALTER TYPE "CanonicalEventType" ADD VALUE IF NOT EXISTS 'PARTNERSHIP';
ALTER TYPE "CanonicalEventType" ADD VALUE IF NOT EXISTS 'INDUSTRY';
ALTER TYPE "CanonicalEventType" ADD VALUE IF NOT EXISTS 'PRICE_MOVE';

CREATE TYPE "StockEventAnalysisStatus" AS ENUM (
  'PENDING',
  'ANALYZING',
  'ANALYZED',
  'SKIPPED',
  'FAILED'
);

ALTER TABLE "CanonicalEvent"
ADD COLUMN "eventTypes" "CanonicalEventType"[] NOT NULL DEFAULT ARRAY[]::"CanonicalEventType"[],
ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "analysisStatus" "StockEventAnalysisStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "analysisError" TEXT,
ADD COLUMN "embedding" vector,
ADD COLUMN "embeddingModel" TEXT,
ADD COLUMN "embeddingInputHash" TEXT,
ADD COLUMN "embeddingUpdatedAt" TIMESTAMP(3);

UPDATE "CanonicalEvent"
SET
  "eventTypes" = ARRAY["eventType"]::"CanonicalEventType"[],
  "lastSeenAt" = "updatedAt",
  "analysisStatus" = CASE
    WHEN "analysisCompletedAt" IS NOT NULL THEN 'ANALYZED'::"StockEventAnalysisStatus"
    WHEN "analysisClaimedAt" IS NOT NULL THEN 'ANALYZING'::"StockEventAnalysisStatus"
    WHEN "materiality" IN ('HIGH', 'EXTREME') THEN 'PENDING'::"StockEventAnalysisStatus"
    ELSE 'SKIPPED'::"StockEventAnalysisStatus"
  END;

CREATE INDEX "CanonicalEvent_ticker_lastSeenAt_idx"
ON "CanonicalEvent"("ticker", "lastSeenAt");

CREATE INDEX "CanonicalEvent_embedding_model_last_seen_idx"
ON "CanonicalEvent"("embeddingModel", "lastSeenAt")
WHERE "embedding" IS NOT NULL;

ALTER TABLE "CanonicalEvent"
ADD CONSTRAINT "CanonicalEvent_embedding_metadata_check" CHECK (
  ("embedding" IS NULL AND "embeddingModel" IS NULL AND "embeddingInputHash" IS NULL AND "embeddingUpdatedAt" IS NULL)
  OR
  ("embedding" IS NOT NULL AND "embeddingModel" IS NOT NULL AND "embeddingInputHash" IS NOT NULL AND "embeddingUpdatedAt" IS NOT NULL)
);

ALTER TABLE "StockAlert"
ADD COLUMN "deliverAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "StockAlert_watcherConfigId_deliverAfter_sentAt_idx"
ON "StockAlert"("watcherConfigId", "deliverAfter", "sentAt");

ALTER TABLE "MarketSnapshot"
ADD COLUMN "returnVolatilityRatio" DECIMAL(12, 6);
