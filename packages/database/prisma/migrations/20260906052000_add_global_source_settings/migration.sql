ALTER TABLE "WatcherConfig"
ADD COLUMN "sourceSettings" JSONB NOT NULL DEFAULT '{}';

WITH "PerStockSource" AS (
  SELECT
    stock."chatConfigId",
    config."source"::text AS "source",
    bool_and(config."enabled") AS "enabled"
  FROM "StockSourceConfig" config
  JOIN "Stock" stock ON stock."id" = config."stockId"
  GROUP BY stock."chatConfigId", config."source"
),
"StockSettings" AS (
  SELECT
    "chatConfigId",
    jsonb_object_agg("source", "enabled") AS "settings"
  FROM "PerStockSource"
  GROUP BY "chatConfigId"
)
UPDATE "WatcherConfig" watcher
SET "sourceSettings" = settings."settings"
FROM "StockSettings" settings
WHERE watcher."chatConfigId" = settings."chatConfigId";

WITH "PerQuerySource" AS (
  SELECT
    query."chatConfigId",
    config."source"::text AS "source",
    bool_and(config."enabled") AS "enabled"
  FROM "PublicationSourceConfig" config
  JOIN "PublicationQuery" query ON query."id" = config."queryId"
  GROUP BY query."chatConfigId", config."source"
),
"PublicationSettings" AS (
  SELECT
    "chatConfigId",
    jsonb_object_agg("source", "enabled") AS "settings"
  FROM "PerQuerySource"
  GROUP BY "chatConfigId"
)
UPDATE "WatcherConfig" watcher
SET "sourceSettings" = settings."settings"
FROM "PublicationSettings" settings
WHERE watcher."chatConfigId" = settings."chatConfigId";

UPDATE "StockSourceConfig" config
SET "enabled" = COALESCE(
  (watcher."sourceSettings" ->> config."source"::text)::boolean,
  true
)
FROM "Stock" stock, "WatcherConfig" watcher
WHERE config."stockId" = stock."id"
  AND watcher."chatConfigId" = stock."chatConfigId";

UPDATE "PublicationSourceConfig" config
SET "enabled" = COALESCE(
  (watcher."sourceSettings" ->> config."source"::text)::boolean,
  true
)
FROM "PublicationQuery" query, "WatcherConfig" watcher
WHERE config."queryId" = query."id"
  AND watcher."chatConfigId" = query."chatConfigId";
