CREATE TABLE "calendar_integration_state" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT,
    "oauthStateHash" TEXT,
    "oauthStateExpiresAt" TIMESTAMP(3),
    "calendarIds" TEXT[] NOT NULL DEFAULT ARRAY['primary']::TEXT[],
    "connectedAt" TIMESTAMP(3),
    "lastRefreshAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "calendar_integration_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "calendar_integration_state_settingsId_key" ON "calendar_integration_state"("settingsId");
CREATE UNIQUE INDEX "calendar_integration_state_oauthStateHash_key" ON "calendar_integration_state"("oauthStateHash");

ALTER TABLE "calendar_integration_state" ADD CONSTRAINT "calendar_integration_state_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "briefing_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
