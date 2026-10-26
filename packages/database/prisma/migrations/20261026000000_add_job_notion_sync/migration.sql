CREATE TYPE "JobNotionSyncStatus" AS ENUM ('PENDING', 'SYNCING', 'SYNCED', 'FAILED');

CREATE TABLE "job_notion_syncs" (
    "jobId" TEXT NOT NULL,
    "pageId" TEXT,
    "contentHash" TEXT,
    "syncStatus" "JobNotionSyncStatus" NOT NULL DEFAULT 'PENDING',
    "claimedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_notion_syncs_pkey" PRIMARY KEY ("jobId")
);

CREATE UNIQUE INDEX "job_notion_syncs_pageId_key" ON "job_notion_syncs"("pageId");
CREATE INDEX "job_notion_syncs_syncStatus_updatedAt_idx" ON "job_notion_syncs"("syncStatus", "updatedAt");

ALTER TABLE "job_notion_syncs"
ADD CONSTRAINT "job_notion_syncs_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
