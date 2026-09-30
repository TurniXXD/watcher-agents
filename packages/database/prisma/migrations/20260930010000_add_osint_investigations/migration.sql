CREATE TABLE "osint_investigations" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "seed" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "depthLimit" INTEGER NOT NULL DEFAULT 1,
  "lastError" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "osint_investigations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "osint_investigations_userId_createdAt_idx" ON "osint_investigations"("userId", "createdAt");
CREATE INDEX "osint_investigations_status_updatedAt_idx" ON "osint_investigations"("status", "updatedAt");

CREATE TABLE "osint_contexts" (
  "chatId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "investigationId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "osint_contexts_pkey" PRIMARY KEY ("chatId", "userId")
);
ALTER TABLE "osint_contexts" ADD CONSTRAINT "osint_contexts_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "osint_investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "osint_selectors" (
  "id" TEXT NOT NULL,
  "investigationId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "original" TEXT NOT NULL,
  "depth" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "osint_selectors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "osint_selectors_investigationId_type_value_key" ON "osint_selectors"("investigationId", "type", "value");
CREATE INDEX "osint_selectors_investigationId_depth_idx" ON "osint_selectors"("investigationId", "depth");
ALTER TABLE "osint_selectors" ADD CONSTRAINT "osint_selectors_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "osint_investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "osint_evidence" (
  "id" TEXT NOT NULL,
  "investigationId" TEXT NOT NULL,
  "collectorId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "excerpt" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "observedAt" TIMESTAMP(3),
  "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "osint_evidence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "osint_evidence_investigationId_sourceKey_contentHash_key" ON "osint_evidence"("investigationId", "sourceKey", "contentHash");
CREATE INDEX "osint_evidence_investigationId_collectedAt_idx" ON "osint_evidence"("investigationId", "collectedAt");
ALTER TABLE "osint_evidence" ADD CONSTRAINT "osint_evidence_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "osint_investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "osint_entities" (
  "id" TEXT NOT NULL,
  "investigationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "osint_entities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "osint_entities_investigationId_kind_key_key" ON "osint_entities"("investigationId", "kind", "key");
CREATE INDEX "osint_entities_investigationId_kind_idx" ON "osint_entities"("investigationId", "kind");
ALTER TABLE "osint_entities" ADD CONSTRAINT "osint_entities_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "osint_investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "osint_observations" (
  "id" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "predicate" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "valueHash" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "observedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "osint_observations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "osint_observations_entityId_predicate_valueHash_evidenceId_key" ON "osint_observations"("entityId", "predicate", "valueHash", "evidenceId");
CREATE INDEX "osint_observations_entityId_predicate_idx" ON "osint_observations"("entityId", "predicate");
ALTER TABLE "osint_observations" ADD CONSTRAINT "osint_observations_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "osint_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "osint_observations" ADD CONSTRAINT "osint_observations_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "osint_evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "osint_relationships" (
  "id" TEXT NOT NULL,
  "fromEntityId" TEXT NOT NULL,
  "toEntityId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "validFrom" TIMESTAMP(3),
  "validTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "osint_relationships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "osint_relationships_fromEntityId_toEntityId_type_evidenceId_key" ON "osint_relationships"("fromEntityId", "toEntityId", "type", "evidenceId");
CREATE INDEX "osint_relationships_toEntityId_idx" ON "osint_relationships"("toEntityId");
ALTER TABLE "osint_relationships" ADD CONSTRAINT "osint_relationships_fromEntityId_fkey" FOREIGN KEY ("fromEntityId") REFERENCES "osint_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "osint_relationships" ADD CONSTRAINT "osint_relationships_toEntityId_fkey" FOREIGN KEY ("toEntityId") REFERENCES "osint_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "osint_relationships" ADD CONSTRAINT "osint_relationships_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "osint_evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "osint_collector_runs" (
  "id" TEXT NOT NULL,
  "investigationId" TEXT NOT NULL,
  "selectorId" TEXT NOT NULL,
  "collectorId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "error" TEXT,
  "evidenceCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "osint_collector_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "osint_collector_runs_investigationId_startedAt_idx" ON "osint_collector_runs"("investigationId", "startedAt");
CREATE INDEX "osint_collector_runs_status_startedAt_idx" ON "osint_collector_runs"("status", "startedAt");
ALTER TABLE "osint_collector_runs" ADD CONSTRAINT "osint_collector_runs_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "osint_investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "osint_collector_runs" ADD CONSTRAINT "osint_collector_runs_selectorId_fkey" FOREIGN KEY ("selectorId") REFERENCES "osint_selectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "osint_watches" (
  "investigationId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "intervalMinutes" INTEGER NOT NULL DEFAULT 1440,
  "nextRunAt" TIMESTAMP(3) NOT NULL,
  "lastNotifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "osint_watches_pkey" PRIMARY KEY ("investigationId")
);
CREATE INDEX "osint_watches_enabled_nextRunAt_idx" ON "osint_watches"("enabled", "nextRunAt");
ALTER TABLE "osint_watches" ADD CONSTRAINT "osint_watches_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "osint_investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
