ALTER TYPE "BriefingDeliveryChannel" ADD VALUE 'GOALS';

CREATE TABLE "briefing_goals" (
    "id" SERIAL NOT NULL,
    "settingsId" TEXT NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "dueOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "briefing_goals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "briefing_goals_settingsId_dueOn_id_idx" ON "briefing_goals"("settingsId", "dueOn", "id");

ALTER TABLE "briefing_goals" ADD CONSTRAINT "briefing_goals_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "briefing_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
