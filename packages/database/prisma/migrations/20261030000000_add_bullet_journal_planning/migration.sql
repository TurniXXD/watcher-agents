CREATE TYPE "BriefingGoalHorizon" AS ENUM ('LONG_TERM', 'MONTHLY', 'WEEKLY');
CREATE TYPE "BriefingGoalStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED', 'CANCELLED');
CREATE TYPE "BriefingTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'COMPLETED', 'MIGRATED', 'CANCELLED', 'BACKLOG');
CREATE TYPE "BriefingPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'PRIMARY');
CREATE TYPE "BriefingTaskSource" AS ENUM ('PLANNED', 'UNPLANNED');
CREATE TYPE "PlanningSessionKind" AS ENUM ('MORNING', 'DAILY_REVIEW', 'WEEKLY_REVIEW', 'MONTHLY_REVIEW');
CREATE TYPE "PlanningSessionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED', 'POSTPONED', 'CANCELLED');
CREATE TYPE "BriefingReviewType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
CREATE TYPE "PlanningSyncStatus" AS ENUM ('NOT_READY', 'PENDING', 'SYNCED', 'FAILED', 'CONFLICT');
CREATE TYPE "BriefingTaskMigrationDecision" AS ENUM ('MIGRATED', 'RESCHEDULED', 'BACKLOG', 'CANCELLED');

ALTER TABLE "briefing_goals" ADD COLUMN "publicId" TEXT;
UPDATE "briefing_goals" SET "publicId" = gen_random_uuid()::text WHERE "publicId" IS NULL;
ALTER TABLE "briefing_goals" ALTER COLUMN "publicId" SET NOT NULL;
ALTER TABLE "briefing_goals" ADD COLUMN "description" TEXT;
ALTER TABLE "briefing_goals" ADD COLUMN "horizon" "BriefingGoalHorizon" NOT NULL DEFAULT 'LONG_TERM';
ALTER TABLE "briefing_goals" ADD COLUMN "status" "BriefingGoalStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "briefing_goals" ADD COLUMN "priority" "BriefingPriority" NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "briefing_goals" ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "briefing_goals" ADD COLUMN "parentGoalId" INTEGER;
ALTER TABLE "briefing_goals" ADD COLUMN "startOn" DATE;
ALTER TABLE "briefing_goals" ADD COLUMN "notionPageId" TEXT;
ALTER TABLE "briefing_goals" ADD COLUMN "notionPageUrl" TEXT;
ALTER TABLE "briefing_goals" ADD COLUMN "syncStatus" "PlanningSyncStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "briefing_goals" ADD COLUMN "syncAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "briefing_goals" ADD COLUMN "syncNextAttemptAt" TIMESTAMP(3);
ALTER TABLE "briefing_goals" ADD COLUMN "syncError" TEXT;

DROP INDEX "briefing_goals_settingsId_dueOn_id_idx";
CREATE UNIQUE INDEX "briefing_goals_publicId_key" ON "briefing_goals"("publicId");
CREATE UNIQUE INDEX "briefing_goals_notionPageId_key" ON "briefing_goals"("notionPageId");
CREATE INDEX "briefing_goals_settingsId_horizon_status_dueOn_id_idx" ON "briefing_goals"("settingsId", "horizon", "status", "dueOn", "id");
CREATE INDEX "briefing_goals_parentGoalId_idx" ON "briefing_goals"("parentGoalId");
CREATE INDEX "briefing_goals_syncStatus_syncNextAttemptAt_idx" ON "briefing_goals"("syncStatus", "syncNextAttemptAt");
ALTER TABLE "briefing_goals" ADD CONSTRAINT "briefing_goals_parentGoalId_fkey" FOREIGN KEY ("parentGoalId") REFERENCES "briefing_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "briefing_tasks" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "description" TEXT,
    "planningDate" VARCHAR(10) NOT NULL,
    "status" "BriefingTaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "BriefingPriority" NOT NULL DEFAULT 'NORMAL',
    "estimatedMinutes" INTEGER,
    "actualMinutes" INTEGER,
    "scheduledAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "goalId" INTEGER,
    "planningSessionId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" "BriefingTaskSource" NOT NULL DEFAULT 'PLANNED',
    "completedAt" TIMESTAMP(3),
    "notionPageId" TEXT,
    "notionPageUrl" TEXT,
    "syncStatus" "PlanningSyncStatus" NOT NULL DEFAULT 'PENDING',
    "syncAttempts" INTEGER NOT NULL DEFAULT 0,
    "syncNextAttemptAt" TIMESTAMP(3),
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "briefing_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "briefing_task_migrations" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromDate" VARCHAR(10) NOT NULL,
    "toDate" VARCHAR(10),
    "decision" "BriefingTaskMigrationDecision" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "briefing_task_migrations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "planning_sessions" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "kind" "PlanningSessionKind" NOT NULL,
    "periodStart" VARCHAR(10) NOT NULL,
    "periodEnd" VARCHAR(10) NOT NULL,
    "status" "PlanningSessionStatus" NOT NULL DEFAULT 'PENDING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "draft" JSONB NOT NULL DEFAULT '{}',
    "reminderAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "reminderLeaseUntil" TIMESTAMP(3),
    "followUpSentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "planning_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "briefing_reviews" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "type" "BriefingReviewType" NOT NULL,
    "periodStart" VARCHAR(10) NOT NULL,
    "periodEnd" VARCHAR(10) NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "summary" TEXT,
    "alignment" TEXT,
    "nextPriorities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "monthlyPrinciples" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dailyPractice" TEXT,
    "notionPageId" TEXT,
    "notionPageUrl" TEXT,
    "syncStatus" "PlanningSyncStatus" NOT NULL DEFAULT 'PENDING',
    "syncAttempts" INTEGER NOT NULL DEFAULT 0,
    "syncNextAttemptAt" TIMESTAMP(3),
    "syncError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "briefing_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "briefing_tasks_notionPageId_key" ON "briefing_tasks"("notionPageId");
CREATE INDEX "briefing_tasks_settingsId_planningDate_status_idx" ON "briefing_tasks"("settingsId", "planningDate", "status");
CREATE INDEX "briefing_tasks_goalId_idx" ON "briefing_tasks"("goalId");
CREATE INDEX "briefing_tasks_planningSessionId_idx" ON "briefing_tasks"("planningSessionId");
CREATE INDEX "briefing_tasks_syncStatus_syncNextAttemptAt_idx" ON "briefing_tasks"("syncStatus", "syncNextAttemptAt");
CREATE INDEX "briefing_task_migrations_taskId_createdAt_idx" ON "briefing_task_migrations"("taskId", "createdAt");
CREATE UNIQUE INDEX "planning_sessions_settingsId_telegramUserId_kind_periodStart_key" ON "planning_sessions"("settingsId", "telegramUserId", "kind", "periodStart");
CREATE INDEX "planning_sessions_status_reminderAt_idx" ON "planning_sessions"("status", "reminderAt");
CREATE INDEX "planning_sessions_settingsId_telegramUserId_updatedAt_idx" ON "planning_sessions"("settingsId", "telegramUserId", "updatedAt");
CREATE UNIQUE INDEX "briefing_reviews_notionPageId_key" ON "briefing_reviews"("notionPageId");
CREATE UNIQUE INDEX "briefing_reviews_settingsId_type_periodStart_periodEnd_key" ON "briefing_reviews"("settingsId", "type", "periodStart", "periodEnd");
CREATE INDEX "briefing_reviews_syncStatus_syncNextAttemptAt_idx" ON "briefing_reviews"("syncStatus", "syncNextAttemptAt");

ALTER TABLE "briefing_tasks" ADD CONSTRAINT "briefing_tasks_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "briefing_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "briefing_tasks" ADD CONSTRAINT "briefing_tasks_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "briefing_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "briefing_tasks" ADD CONSTRAINT "briefing_tasks_planningSessionId_fkey" FOREIGN KEY ("planningSessionId") REFERENCES "planning_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "briefing_task_migrations" ADD CONSTRAINT "briefing_task_migrations_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "briefing_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planning_sessions" ADD CONSTRAINT "planning_sessions_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "briefing_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "briefing_reviews" ADD CONSTRAINT "briefing_reviews_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "briefing_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Medical publications are no longer a Briefing Bot input. Preserve all rows,
-- but disable the existing subscription and the producer schedule.
UPDATE "briefing_subscriptions" SET "enabled" = false, "updatedAt" = CURRENT_TIMESTAMP WHERE "watcherBot" = 'MEDICAL';
UPDATE "WatcherConfig" AS config
SET "enabled" = false, "updatedAt" = CURRENT_TIMESTAMP
FROM "TelegramChat" AS chat
WHERE config."chatConfigId" = chat."id" AND chat."kind" = 'PUBLICATIONS';
