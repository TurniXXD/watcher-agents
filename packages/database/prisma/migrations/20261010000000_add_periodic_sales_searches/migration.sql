CREATE TABLE "sales_search_subscriptions" (
  "id" TEXT NOT NULL,
  "telegramChatId" BIGINT NOT NULL,
  "telegramUserId" BIGINT NOT NULL,
  "query" TEXT NOT NULL,
  "normalizedQuery" TEXT NOT NULL,
  "locality" TEXT NOT NULL,
  "normalizedLocality" TEXT NOT NULL,
  "resultLimit" INTEGER NOT NULL DEFAULT 10,
  "intervalMinutes" INTEGER NOT NULL DEFAULT 30,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastRunAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_search_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_search_seen_results" (
  "subscriptionId" TEXT NOT NULL,
  "resultKey" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_search_seen_results_pkey" PRIMARY KEY ("subscriptionId", "resultKey")
);

CREATE UNIQUE INDEX "sales_search_subscriptions_telegramChatId_normalizedQuery_normalizedLocality_key"
  ON "sales_search_subscriptions"("telegramChatId", "normalizedQuery", "normalizedLocality");
CREATE INDEX "sales_search_subscriptions_enabled_nextRunAt_idx"
  ON "sales_search_subscriptions"("enabled", "nextRunAt");

ALTER TABLE "sales_search_seen_results"
  ADD CONSTRAINT "sales_search_seen_results_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "sales_search_subscriptions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
