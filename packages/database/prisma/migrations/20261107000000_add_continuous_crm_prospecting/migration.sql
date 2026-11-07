ALTER TABLE "sales_search_subscriptions"
  ADD COLUMN "autoImportToCrm" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pageOffset" INTEGER NOT NULL DEFAULT 0;

DROP INDEX "sales_search_subscriptions_telegramChatId_normalizedQuery_normalizedLocality_key";
CREATE UNIQUE INDEX "sales_search_subscriptions_telegramChatId_normalizedQuery_normalizedLocality_autoImportToCrm_key"
  ON "sales_search_subscriptions"("telegramChatId", "normalizedQuery", "normalizedLocality", "autoImportToCrm");
