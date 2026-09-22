CREATE TABLE "transport_users" (
  "id" TEXT NOT NULL,
  "telegramChatId" BIGINT NOT NULL,
  "vehicleProfile" JSONB,
  "costSettings" JSONB,
  "preferences" JSONB,
  "conversation" JSONB,
  "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
  "automaticDiscovery" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "transport_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "transport_users_telegramChatId_key" ON "transport_users"("telegramChatId");
CREATE INDEX "transport_users_automaticDiscovery_onboardingComplete_idx" ON "transport_users"("automaticDiscovery", "onboardingComplete");

CREATE TABLE "transport_request_observations" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "normalized" JSONB NOT NULL,
  "raw" JSONB NOT NULL,
  "contentHash" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disappearedAt" TIMESTAMP(3),
  CONSTRAINT "transport_request_observations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "transport_request_observations_source_externalId_key" ON "transport_request_observations"("source", "externalId");
CREATE INDEX "transport_request_observations_disappearedAt_expiresAt_publishedAt_idx" ON "transport_request_observations"("disappearedAt", "expiresAt", "publishedAt");

CREATE TABLE "transport_planned_trips" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "trip" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "transport_planned_trips_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "transport_planned_trips_userId_status_createdAt_idx" ON "transport_planned_trips"("userId", "status", "createdAt");

CREATE TABLE "transport_opportunities" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "plannedTripId" TEXT,
  "kind" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "confidence" TEXT NOT NULL,
  "compatibility" TEXT NOT NULL,
  "route" JSONB NOT NULL,
  "economics" JSONB NOT NULL,
  "warnings" JSONB NOT NULL,
  "notifiedAt" TIMESTAMP(3),
  "ignoredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "transport_opportunities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "transport_opportunities_userId_requestId_kind_plannedTripId_key" ON "transport_opportunities"("userId", "requestId", "kind", "plannedTripId");
CREATE INDEX "transport_opportunities_userId_notifiedAt_ignoredAt_score_idx" ON "transport_opportunities"("userId", "notifiedAt", "ignoredAt", "score");

CREATE TABLE "transport_rejections" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "explanation" TEXT NOT NULL,
  "context" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transport_rejections_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "transport_rejections_userId_requestId_createdAt_idx" ON "transport_rejections"("userId", "requestId", "createdAt");
CREATE INDEX "transport_rejections_code_createdAt_idx" ON "transport_rejections"("code", "createdAt");

CREATE TABLE "transport_route_cache" (
  "cacheKey" TEXT NOT NULL,
  "route" JSONB NOT NULL,
  "provider" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "transport_route_cache_pkey" PRIMARY KEY ("cacheKey")
);
CREATE INDEX "transport_route_cache_expiresAt_idx" ON "transport_route_cache"("expiresAt");

CREATE TABLE "transport_geocoding_cache" (
  "query" TEXT NOT NULL,
  "location" JSONB NOT NULL,
  "provider" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "transport_geocoding_cache_pkey" PRIMARY KEY ("query")
);
CREATE INDEX "transport_geocoding_cache_expiresAt_idx" ON "transport_geocoding_cache"("expiresAt");

CREATE TABLE "transport_fuel_price_cache" (
  "country" TEXT NOT NULL,
  "fuel" TEXT NOT NULL,
  "pricePerLiter" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "transport_fuel_price_cache_pkey" PRIMARY KEY ("country", "fuel")
);

ALTER TABLE "transport_planned_trips" ADD CONSTRAINT "transport_planned_trips_userId_fkey" FOREIGN KEY ("userId") REFERENCES "transport_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transport_opportunities" ADD CONSTRAINT "transport_opportunities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "transport_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transport_opportunities" ADD CONSTRAINT "transport_opportunities_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "transport_request_observations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transport_opportunities" ADD CONSTRAINT "transport_opportunities_plannedTripId_fkey" FOREIGN KEY ("plannedTripId") REFERENCES "transport_planned_trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transport_rejections" ADD CONSTRAINT "transport_rejections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "transport_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transport_rejections" ADD CONSTRAINT "transport_rejections_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "transport_request_observations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
