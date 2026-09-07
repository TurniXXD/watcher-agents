CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "briefing_events"
ADD COLUMN "embedding" vector,
ADD COLUMN "embeddingModel" TEXT,
ADD COLUMN "embeddingInputHash" TEXT,
ADD COLUMN "embeddingUpdatedAt" TIMESTAMP(3);

CREATE INDEX "briefing_events_embedding_model_detected_at_idx"
ON "briefing_events"("embeddingModel", "detectedAt")
WHERE "embedding" IS NOT NULL;

ALTER TABLE "briefing_events"
ADD CONSTRAINT "briefing_events_embedding_metadata_check" CHECK (
  ("embedding" IS NULL AND "embeddingModel" IS NULL AND "embeddingInputHash" IS NULL AND "embeddingUpdatedAt" IS NULL)
  OR
  ("embedding" IS NOT NULL AND "embeddingModel" IS NOT NULL AND "embeddingInputHash" IS NOT NULL AND "embeddingUpdatedAt" IS NOT NULL)
);
