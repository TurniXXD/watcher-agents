ALTER TABLE "briefing_settings" ADD COLUMN "nextBriefingAt" TIMESTAMP(3);

CREATE INDEX "briefing_settings_onboardingComplete_nextBriefingAt_idx"
ON "briefing_settings"("onboardingComplete", "nextBriefingAt");
