-- CreateEnum
CREATE TYPE "BrnoEventCmsSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "brno_event_cms_sync" (
    "eventId" TEXT NOT NULL,
    "status" "BrnoEventCmsSyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),
    "syncedHash" TEXT,
    "syncedAt" TIMESTAMP(3),
    "cmsId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brno_event_cms_sync_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE INDEX "brno_event_cms_sync_status_nextAttemptAt_idx" ON "brno_event_cms_sync"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "brno_event_cms_sync" ADD CONSTRAINT "brno_event_cms_sync_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "brno_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
