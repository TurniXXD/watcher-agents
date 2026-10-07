CREATE TABLE "reality_users" (
  "id" TEXT NOT NULL,
  "telegramChatId" BIGINT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "reportSchedule" TEXT NOT NULL DEFAULT '0 8 1 * *',
  "timezone" TEXT NOT NULL DEFAULT 'Europe/Prague',
  "nextReportAt" TIMESTAMP(3) NOT NULL,
  "lastReportAt" TIMESTAMP(3),
  "lastRunStatus" "RunStatus",
  "runInProgress" BOOLEAN NOT NULL DEFAULT false,
  "runStartedAt" TIMESTAMP(3),
  "locations" TEXT[] NOT NULL DEFAULT ARRAY['Brno', 'Ostrava', 'Frýdek-Místek']::TEXT[],
  "model" JSONB NOT NULL DEFAULT '{"purchasePriceCzk":3000000,"floorAreaM2":60,"equityPercent":30,"termYears":30,"vacancyPercent":5,"annualMaintenancePercent":1,"annualInsuranceCzk":3000,"otherAnnualOwnerCostsCzk":0}',
  "alertGrossYieldPercent" DECIMAL(8,4) NOT NULL DEFAULT 6,
  "alertDiscountPercent" DECIMAL(8,4) NOT NULL DEFAULT 15,
  "alertCashflowRate" DECIMAL(8,4) NOT NULL DEFAULT 5,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reality_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reality_runs" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "trigger" "RunTrigger" NOT NULL,
  "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "metricsFetched" INTEGER NOT NULL DEFAULT 0,
  "listingsFetched" INTEGER NOT NULL DEFAULT 0,
  "newListings" INTEGER NOT NULL DEFAULT 0,
  "alertsSent" INTEGER NOT NULL DEFAULT 0,
  "sourceFailures" JSONB NOT NULL DEFAULT '[]',
  "error" TEXT,
  CONSTRAINT "reality_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reality_metrics" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "location" TEXT,
  "disposition" TEXT,
  "value" DECIMAL(24,8) NOT NULL,
  "unit" TEXT NOT NULL,
  "period" TIMESTAMP(3) NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "sourceUrl" TEXT,
  "raw" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reality_metrics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reality_listings" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "disposition" TEXT,
  "priceCzk" DECIMAL(16,2) NOT NULL,
  "floorAreaM2" DECIMAL(12,2) NOT NULL,
  "estimatedMonthlyRentCzk" DECIMAL(16,2),
  "annualOwnerCostsCzk" DECIMAL(16,2),
  "acquisitionCostsCzk" DECIMAL(16,2),
  "localMedianPricePerM2Czk" DECIMAL(16,2),
  "publishedAt" TIMESTAMP(3),
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disappearedAt" TIMESTAMP(3),
  "raw" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reality_listings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reality_listing_prices" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "priceCzk" DECIMAL(16,2) NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reality_listing_prices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reality_alerts" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reality_alerts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reality_reports" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "period" TIMESTAMP(3) NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reality_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reality_users_telegramChatId_key" ON "reality_users"("telegramChatId");
CREATE INDEX "reality_users_enabled_nextReportAt_idx" ON "reality_users"("enabled", "nextReportAt");
CREATE INDEX "reality_runs_userId_startedAt_idx" ON "reality_runs"("userId", "startedAt");
CREATE UNIQUE INDEX "reality_metrics_source_externalId_key" ON "reality_metrics"("source", "externalId");
CREATE INDEX "reality_metrics_metric_location_period_idx" ON "reality_metrics"("metric", "location", "period");
CREATE INDEX "reality_metrics_category_period_idx" ON "reality_metrics"("category", "period");
CREATE UNIQUE INDEX "reality_listings_source_externalId_key" ON "reality_listings"("source", "externalId");
CREATE INDEX "reality_listings_location_disappearedAt_lastSeenAt_idx" ON "reality_listings"("location", "disappearedAt", "lastSeenAt");
CREATE INDEX "reality_listing_prices_listingId_observedAt_idx" ON "reality_listing_prices"("listingId", "observedAt");
CREATE UNIQUE INDEX "reality_alerts_userId_listingId_signature_key" ON "reality_alerts"("userId", "listingId", "signature");
CREATE INDEX "reality_alerts_userId_sentAt_idx" ON "reality_alerts"("userId", "sentAt");
CREATE UNIQUE INDEX "reality_reports_runId_key" ON "reality_reports"("runId");
CREATE UNIQUE INDEX "reality_reports_userId_period_key" ON "reality_reports"("userId", "period");
CREATE INDEX "reality_reports_userId_createdAt_idx" ON "reality_reports"("userId", "createdAt");

ALTER TABLE "reality_runs" ADD CONSTRAINT "reality_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "reality_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reality_listing_prices" ADD CONSTRAINT "reality_listing_prices_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "reality_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reality_alerts" ADD CONSTRAINT "reality_alerts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "reality_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reality_alerts" ADD CONSTRAINT "reality_alerts_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "reality_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reality_reports" ADD CONSTRAINT "reality_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "reality_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reality_reports" ADD CONSTRAINT "reality_reports_runId_fkey" FOREIGN KEY ("runId") REFERENCES "reality_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
