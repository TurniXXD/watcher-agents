CREATE TYPE "MonitoringTier" AS ENUM ('CORE', 'WATCH', 'DISCOVERY', 'INVESTIGATE');
CREATE TYPE "MonitoringMode" AS ENUM ('LOW_RESOLUTION', 'NORMAL', 'HIGH_RESOLUTION', 'EVENT_MODE');

ALTER TABLE "Stock"
  ADD COLUMN "exchange" TEXT,
  ADD COLUMN "sector" TEXT,
  ADD COLUMN "industry" TEXT,
  ADD COLUMN "marketCap" DECIMAL(24,2),
  ADD COLUMN "currency" TEXT,
  ADD COLUMN "country" TEXT,
  ADD COLUMN "investorRelationsUrl" TEXT,
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "monitoringTier" "MonitoringTier" NOT NULL DEFAULT 'WATCH',
  ADD COLUMN "monitoringMode" "MonitoringMode" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "watchReason" TEXT,
  ADD COLUMN "watchUntil" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ProcessedItem"
  ADD COLUMN "ticker" TEXT,
  ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "sourceUrl" TEXT,
  ADD COLUMN "primarySource" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "eventAt" TIMESTAMP(3),
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "headline" TEXT,
  ADD COLUMN "rawText" TEXT,
  ADD COLUMN "normalizedFacts" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "entities" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "reliability" DOUBLE PRECISION NOT NULL DEFAULT 0.5;

UPDATE "ProcessedItem"
SET
  "sourceUrl" = "url",
  "headline" = "title"
WHERE "sourceUrl" IS NULL OR "headline" IS NULL;

CREATE TABLE "DomainEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DomainEvent_type_occurredAt_idx" ON "DomainEvent"("type", "occurredAt");
CREATE INDEX "DomainEvent_aggregateType_aggregateId_occurredAt_idx" ON "DomainEvent"("aggregateType", "aggregateId", "occurredAt");
