CREATE TYPE "AgentRunStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');
CREATE TYPE "AgentFeedbackConsumer" AS ENUM ('BRIEFING_AGENT', 'TELEGRAM', 'USER', 'OTHER');
CREATE TYPE "AgentFeedbackAction" AS ENUM ('INCLUDED', 'FILTERED', 'OPENED', 'IGNORED', 'DISMISSED', 'ACTED_ON', 'MARKED_USEFUL', 'MARKED_NOT_USEFUL');
CREATE TYPE "MaintenanceFindingType" AS ENUM ('RECURRING_FAILURE', 'NOISY_OUTPUT', 'STALE_SOURCE', 'DUPLICATE_OUTPUT', 'POOR_CLASSIFICATION', 'HIGH_LATENCY', 'HIGH_COST', 'LOW_VALUE_OUTPUT', 'SOURCE_DEGRADATION', 'SCHEDULE_ISSUE', 'CONFIGURATION_ISSUE', 'OTHER');
CREATE TYPE "MaintenanceSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "MaintenanceFindingStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED');
CREATE TYPE "MaintenanceRecommendationType" AS ENUM ('PROMPT_CHANGE', 'SOURCE_CHANGE', 'SCRAPER_CHANGE', 'CONFIG_CHANGE', 'THRESHOLD_CHANGE', 'SCHEDULE_CHANGE', 'MODEL_CHANGE', 'CODE_CHANGE', 'REMOVE_SOURCE', 'ADD_SOURCE', 'OTHER');
CREATE TYPE "MaintenanceRecommendationStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'IMPLEMENTED');
CREATE TYPE "MaintenanceRunType" AS ENUM ('HEALTH', 'DAILY', 'WEEKLY', 'MANUAL');
CREATE TYPE "MaintenanceRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

CREATE TABLE "agent_runs" (
  "id" TEXT NOT NULL,
  "agentName" TEXT NOT NULL,
  "agentVersion" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "status" "AgentRunStatus" NOT NULL,
  "input" JSONB,
  "output" JSONB,
  "error" JSONB,
  "latencyMs" INTEGER,
  "llmProvider" TEXT,
  "llmModel" TEXT,
  "llmInputTokens" INTEGER,
  "llmOutputTokens" INTEGER,
  "llmCostUsd" DECIMAL(18,8),
  "itemsFetched" INTEGER,
  "itemsProduced" INTEGER,
  "itemsFiltered" INTEGER,
  "duplicatesRemoved" INTEGER,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_source_runs" (
  "id" TEXT NOT NULL,
  "agentRunId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "url" TEXT,
  "status" TEXT NOT NULL,
  "latencyMs" INTEGER,
  "itemCount" INTEGER,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_source_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_output_feedback" (
  "id" TEXT NOT NULL,
  "agentRunId" TEXT NOT NULL,
  "outputItemId" TEXT,
  "consumer" "AgentFeedbackConsumer" NOT NULL,
  "action" "AgentFeedbackAction" NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_output_feedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "maintenance_source_health" (
  "id" TEXT NOT NULL,
  "agentName" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "windowEndedAt" TIMESTAMP(3) NOT NULL,
  "totalRuns" INTEGER NOT NULL,
  "successfulRuns" INTEGER NOT NULL,
  "failedRuns" INTEGER NOT NULL,
  "successRate" DOUBLE PRECISION NOT NULL,
  "lastSuccessfulAt" TIMESTAMP(3),
  "lastNewItemAt" TIMESTAMP(3),
  "averageLatencyMs" DOUBLE PRECISION,
  "consecutiveFailures" INTEGER NOT NULL,
  "itemsProduced" INTEGER NOT NULL,
  "uniqueItemsProduced" INTEGER NOT NULL,
  "duplicateRate" DOUBLE PRECISION,
  "staleDays" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "maintenance_source_health_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "maintenance_findings" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "agentName" TEXT NOT NULL,
  "type" "MaintenanceFindingType" NOT NULL,
  "severity" "MaintenanceSeverity" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "detectedAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "status" "MaintenanceFindingStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "maintenance_findings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "maintenance_recommendations" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "findingId" TEXT NOT NULL,
  "agentName" TEXT NOT NULL,
  "type" "MaintenanceRecommendationType" NOT NULL,
  "title" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "expectedImpact" TEXT,
  "risk" TEXT,
  "proposal" JSONB,
  "status" "MaintenanceRecommendationStatus" NOT NULL DEFAULT 'PROPOSED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "maintenance_recommendations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "maintenance_runs" (
  "id" TEXT NOT NULL,
  "type" "MaintenanceRunType" NOT NULL,
  "status" "MaintenanceRunStatus" NOT NULL DEFAULT 'RUNNING',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "lookbackHours" INTEGER NOT NULL,
  "findingCount" INTEGER NOT NULL DEFAULT 0,
  "recommendationCount" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "metrics" JSONB,
  CONSTRAINT "maintenance_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "maintenance_change_announcements" (
  "id" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "chatId" BIGINT NOT NULL,
  "title" TEXT NOT NULL,
  "announcedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "maintenance_change_announcements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_source_runs_agentRunId_idx" ON "agent_source_runs"("agentRunId");
CREATE INDEX "agent_runs_agentName_startedAt_idx" ON "agent_runs"("agentName", "startedAt");
CREATE INDEX "agent_runs_status_startedAt_idx" ON "agent_runs"("status", "startedAt");
CREATE INDEX "agent_source_runs_sourceId_createdAt_idx" ON "agent_source_runs"("sourceId", "createdAt");
CREATE INDEX "agent_output_feedback_agentRunId_createdAt_idx" ON "agent_output_feedback"("agentRunId", "createdAt");
CREATE INDEX "agent_output_feedback_consumer_action_createdAt_idx" ON "agent_output_feedback"("consumer", "action", "createdAt");
CREATE UNIQUE INDEX "maintenance_source_health_agentName_sourceId_key" ON "maintenance_source_health"("agentName", "sourceId");
CREATE INDEX "maintenance_source_health_sourceId_updatedAt_idx" ON "maintenance_source_health"("sourceId", "updatedAt");
CREATE INDEX "maintenance_source_health_agentName_successRate_idx" ON "maintenance_source_health"("agentName", "successRate");
CREATE UNIQUE INDEX "maintenance_findings_fingerprint_key" ON "maintenance_findings"("fingerprint");
CREATE INDEX "maintenance_findings_agentName_detectedAt_idx" ON "maintenance_findings"("agentName", "detectedAt");
CREATE INDEX "maintenance_findings_type_severity_status_idx" ON "maintenance_findings"("type", "severity", "status");
CREATE UNIQUE INDEX "maintenance_recommendations_fingerprint_key" ON "maintenance_recommendations"("fingerprint");
CREATE INDEX "maintenance_recommendations_agentName_createdAt_idx" ON "maintenance_recommendations"("agentName", "createdAt");
CREATE INDEX "maintenance_recommendations_type_status_idx" ON "maintenance_recommendations"("type", "status");
CREATE INDEX "maintenance_runs_type_startedAt_idx" ON "maintenance_runs"("type", "startedAt");
CREATE INDEX "maintenance_runs_status_startedAt_idx" ON "maintenance_runs"("status", "startedAt");
CREATE UNIQUE INDEX "maintenance_change_announcements_contentHash_chatId_key" ON "maintenance_change_announcements"("contentHash", "chatId");
CREATE INDEX "maintenance_change_announcements_announcedAt_idx" ON "maintenance_change_announcements"("announcedAt");

ALTER TABLE "agent_source_runs" ADD CONSTRAINT "agent_source_runs_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_output_feedback" ADD CONSTRAINT "agent_output_feedback_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "maintenance_recommendations" ADD CONSTRAINT "maintenance_recommendations_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "maintenance_findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
