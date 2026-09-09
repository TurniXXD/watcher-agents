ALTER TABLE "NewsFeed" ADD COLUMN "builtInKey" TEXT;

CREATE UNIQUE INDEX "NewsFeed_chatConfigId_builtInKey_key"
ON "NewsFeed"("chatConfigId", "builtInKey");
