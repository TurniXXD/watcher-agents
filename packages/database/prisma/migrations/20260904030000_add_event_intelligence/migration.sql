CREATE TYPE "CanonicalEventType" AS ENUM (
  'EARNINGS', 'GUIDANCE', 'INSIDER_TRANSACTION', 'CLINICAL_TRIAL',
  'FDA_DECISION', 'PRODUCT_LAUNCH', 'GOVERNMENT_CONTRACT', 'CONTRACT',
  'PATENT', 'ACQUISITION', 'DIVESTITURE', 'CAPITAL_RAISE', 'BUYBACK',
  'DIVIDEND', 'MANAGEMENT_CHANGE', 'ANALYST_REVISION', 'LEGAL',
  'REGULATORY', 'CONGRESSIONAL_TRANSACTION', 'INSTITUTIONAL_POSITIONING',
  'OFF_EXCHANGE_ANOMALY', 'COMPETITOR_EVENT', 'MACRO_EVENT',
  'PRICE_ANOMALY', 'VOLUME_ANOMALY', 'OPTIONS_ANOMALY', 'OTHER'
);
CREATE TYPE "EventDirection" AS ENUM ('POSITIVE', 'NEGATIVE', 'MIXED', 'NEUTRAL', 'UNKNOWN');
CREATE TYPE "EventSurprise" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'UNKNOWN');
CREATE TYPE "Materiality" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'EXTREME');
CREATE TYPE "EventAction" AS ENUM ('STORE', 'STATE_UPDATE', 'TARGETED_ANALYSIS', 'FULL_ANALYSIS', 'IMMEDIATE_ANALYSIS');
CREATE TYPE "EvidenceRole" AS ENUM ('PRIMARY', 'CONFIRMATION', 'REACTION', 'INTERPRETATION');
CREATE TYPE "EventDecision" AS ENUM ('ANALYZE', 'STORED', 'DUPLICATE', 'COOLDOWN');
CREATE TYPE "SourceHealthStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'RATE_LIMITED', 'UNAVAILABLE');

CREATE TABLE "EventChain" (
  "id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "primaryEventId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventChain_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CanonicalEvent" (
  "id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "eventType" "CanonicalEventType" NOT NULL,
  "title" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3),
  "firstPublicAt" TIMESTAMP(3),
  "firstDetectedAt" TIMESTAMP(3) NOT NULL,
  "direction" "EventDirection" NOT NULL,
  "magnitude" JSONB NOT NULL DEFAULT '{}',
  "surprise" "EventSurprise" NOT NULL,
  "materiality" "Materiality" NOT NULL,
  "materialityScore" INTEGER NOT NULL,
  "materialityReasons" JSONB NOT NULL DEFAULT '[]',
  "action" "EventAction" NOT NULL,
  "evidencePriority" INTEGER NOT NULL,
  "primaryEvidenceId" TEXT NOT NULL,
  "primaryDriverId" TEXT,
  "chainId" TEXT NOT NULL,
  "analysisClaimedAt" TIMESTAMP(3),
  "analysisCompletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CanonicalEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventObservation" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "processedItemId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "role" "EvidenceRole" NOT NULL,
  "decision" "EventDecision" NOT NULL,
  "createdEvent" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalysisCooldown" (
  "scopeKey" TEXT NOT NULL,
  "cooldownUntil" TIMESTAMP(3) NOT NULL,
  "lastClaimedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalysisCooldown_pkey" PRIMARY KEY ("scopeKey")
);

CREATE TABLE "SourceHealth" (
  "id" TEXT NOT NULL,
  "watcherConfigId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "status" "SourceHealthStatus" NOT NULL DEFAULT 'HEALTHY',
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "backoffUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceHealth_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CanonicalEvent_fingerprint_key" ON "CanonicalEvent"("fingerprint");
CREATE INDEX "CanonicalEvent_ticker_eventType_occurredAt_idx" ON "CanonicalEvent"("ticker", "eventType", "occurredAt");
CREATE INDEX "CanonicalEvent_ticker_firstDetectedAt_idx" ON "CanonicalEvent"("ticker", "firstDetectedAt");
CREATE INDEX "CanonicalEvent_chainId_idx" ON "CanonicalEvent"("chainId");
CREATE INDEX "EventChain_ticker_createdAt_idx" ON "EventChain"("ticker", "createdAt");
CREATE UNIQUE INDEX "EventObservation_eventId_processedItemId_key" ON "EventObservation"("eventId", "processedItemId");
CREATE INDEX "EventObservation_runId_idx" ON "EventObservation"("runId");
CREATE INDEX "EventObservation_processedItemId_idx" ON "EventObservation"("processedItemId");
CREATE UNIQUE INDEX "SourceHealth_watcherConfigId_source_target_key" ON "SourceHealth"("watcherConfigId", "source", "target");
CREATE INDEX "SourceHealth_status_backoffUntil_idx" ON "SourceHealth"("status", "backoffUntil");

ALTER TABLE "CanonicalEvent" ADD CONSTRAINT "CanonicalEvent_primaryEvidenceId_fkey"
  FOREIGN KEY ("primaryEvidenceId") REFERENCES "ProcessedItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CanonicalEvent" ADD CONSTRAINT "CanonicalEvent_chainId_fkey"
  FOREIGN KEY ("chainId") REFERENCES "EventChain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventObservation" ADD CONSTRAINT "EventObservation_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "CanonicalEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventObservation" ADD CONSTRAINT "EventObservation_processedItemId_fkey"
  FOREIGN KEY ("processedItemId") REFERENCES "ProcessedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventObservation" ADD CONSTRAINT "EventObservation_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "WatcherRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceHealth" ADD CONSTRAINT "SourceHealth_watcherConfigId_fkey"
  FOREIGN KEY ("watcherConfigId") REFERENCES "WatcherConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
