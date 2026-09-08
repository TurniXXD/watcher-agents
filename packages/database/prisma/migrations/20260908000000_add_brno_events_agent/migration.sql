CREATE TABLE "brno_events" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "normalizedTitle" TEXT NOT NULL,
  "description" TEXT,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3),
  "venueName" TEXT,
  "venueAddress" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "city" TEXT NOT NULL DEFAULT 'Brno',
  "organizerName" TEXT,
  "organizerUrl" TEXT,
  "categories" TEXT[] NOT NULL,
  "language" TEXT,
  "priceAmount" DOUBLE PRECISION,
  "priceCurrency" TEXT,
  "priceFree" BOOLEAN,
  "priceText" TEXT,
  "registrationRequired" BOOLEAN,
  "registrationUrl" TEXT,
  "registrationDeadline" TIMESTAMP(3),
  "imageUrl" TEXT,
  "relevanceScore" INTEGER NOT NULL,
  "relevanceReasons" TEXT[] NOT NULL,
  "recurring" BOOLEAN NOT NULL DEFAULT false,
  "cancelled" BOOLEAN NOT NULL DEFAULT false,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sourceUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "brno_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "brno_events_fingerprint_key" ON "brno_events"("fingerprint");
CREATE INDEX "brno_events_startAt_relevanceScore_idx" ON "brno_events"("startAt", "relevanceScore");
CREATE INDEX "brno_events_firstSeenAt_idx" ON "brno_events"("firstSeenAt");

CREATE TABLE "brno_event_source_links" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceName" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "eventUrl" TEXT NOT NULL,
  "externalId" TEXT,
  "raw" JSONB,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "brno_event_source_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "brno_event_source_links_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "brno_events"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "brno_event_source_links_sourceId_eventUrl_key" ON "brno_event_source_links"("sourceId", "eventUrl");
CREATE INDEX "brno_event_source_links_sourceId_externalId_idx" ON "brno_event_source_links"("sourceId", "externalId");
CREATE INDEX "brno_event_source_links_eventId_idx" ON "brno_event_source_links"("eventId");

CREATE TABLE "brno_event_source_runs" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3) NOT NULL,
  "success" BOOLEAN NOT NULL,
  "fetched" INTEGER NOT NULL DEFAULT 0,
  "created" INTEGER NOT NULL DEFAULT 0,
  "updated" INTEGER NOT NULL DEFAULT 0,
  "duplicates" INTEGER NOT NULL DEFAULT 0,
  "durationMs" INTEGER NOT NULL,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "brno_event_source_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "brno_event_source_runs_sourceId_startedAt_idx" ON "brno_event_source_runs"("sourceId", "startedAt");
