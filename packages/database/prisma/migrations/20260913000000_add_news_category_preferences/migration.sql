CREATE TYPE "NewsCategory" AS ENUM (
  'POLITICS',
  'BUSINESS',
  'ECONOMY',
  'TECHNOLOGY',
  'SCIENCE',
  'HEALTH',
  'SECURITY',
  'CLIMATE',
  'CULTURE',
  'SPORT',
  'OTHER'
);

CREATE TABLE "NewsCategoryPreference" (
  "id" TEXT NOT NULL,
  "chatConfigId" TEXT NOT NULL,
  "scope" "NewsScope" NOT NULL,
  "category" "NewsCategory" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NewsCategoryPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NewsCategoryPreference_chatConfigId_scope_category_key"
ON "NewsCategoryPreference"("chatConfigId", "scope", "category");

CREATE INDEX "NewsCategoryPreference_chatConfigId_scope_enabled_idx"
ON "NewsCategoryPreference"("chatConfigId", "scope", "enabled");

ALTER TABLE "NewsCategoryPreference"
ADD CONSTRAINT "NewsCategoryPreference_chatConfigId_fkey"
FOREIGN KEY ("chatConfigId") REFERENCES "TelegramChat"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "NewsCategoryPreference" (
  "id",
  "chatConfigId",
  "scope",
  "category",
  "enabled",
  "updatedAt"
)
SELECT
  'news-category:' || "id" || ':' || scope."value" || ':SPORT',
  "id",
  scope."value"::"NewsScope",
  'SPORT'::"NewsCategory",
  false,
  CURRENT_TIMESTAMP
FROM "TelegramChat"
CROSS JOIN (VALUES ('CZECH'), ('GLOBAL')) AS scope("value")
WHERE "kind" = 'NEWS'
ON CONFLICT ("chatConfigId", "scope", "category") DO NOTHING;
