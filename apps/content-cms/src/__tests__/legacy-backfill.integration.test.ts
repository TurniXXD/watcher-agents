import { sql } from '@payloadcms/db-postgres';
import type { Payload } from 'payload';
import { beforeAll, describe, expect, it } from 'vitest';
import { eventAdapter } from '../ingestion/adapters';
import { IngestionService } from '../ingestion/service';
import { getTestPayload } from './helpers/payload';
import { backfillLegacyBotContent } from '../ingestion/legacy-backfill';
import { LEGACY_BACKFILL_TASK } from '../jobs/legacy-backfill';

/** Minimal copies of the Prisma tables the backfill reads. */
const createLegacyTables = sql`
  CREATE TYPE "WatcherKind" AS ENUM ('STOCKS', 'PUBLICATIONS', 'NEWS');
  CREATE TYPE "AnalysisStatus" AS ENUM ('SUCCESS', 'FAILED');
  CREATE TABLE "brno_events" (
    "id" TEXT PRIMARY KEY, "title" TEXT NOT NULL, "description" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL, "endAt" TIMESTAMP(3),
    "venueName" TEXT, "venueAddress" TEXT, "city" TEXT NOT NULL DEFAULT 'Brno',
    "organizerName" TEXT, "categories" TEXT[] NOT NULL DEFAULT '{}',
    "priceAmount" DOUBLE PRECISION, "priceCurrency" TEXT, "priceFree" BOOLEAN,
    "registrationRequired" BOOLEAN, "registrationUrl" TEXT, "imageUrl" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE "brno_event_source_links" (
    "id" TEXT PRIMARY KEY, "eventId" TEXT NOT NULL, "sourceName" TEXT NOT NULL,
    "eventUrl" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE "ProcessedItem" (
    "id" TEXT PRIMARY KEY, "watcherKind" "WatcherKind" NOT NULL,
    "source" TEXT NOT NULL, "externalId" TEXT NOT NULL, "title" TEXT NOT NULL,
    "url" TEXT NOT NULL, "publishedAt" TIMESTAMP(3),
    "sourceType" TEXT NOT NULL DEFAULT 'OTHER', "rawText" TEXT,
    "metadata" JSONB NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE "Analysis" (
    "id" TEXT PRIMARY KEY, "processedItemId" TEXT NOT NULL,
    "status" "AnalysisStatus" NOT NULL, "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE "social_content_items" (
    "id" TEXT PRIMARY KEY, "title" TEXT NOT NULL, "channel" TEXT NOT NULL,
    "format" TEXT NOT NULL, "contentPillar" TEXT, "hook" TEXT, "draft" TEXT,
    "finalContent" TEXT, "publishedUrl" TEXT, "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

const seedLegacyRows = sql`
  INSERT INTO "brno_events" ("id", "title", "startAt", "venueName", "categories", "priceFree")
  VALUES ('e-past', 'Past meetup', '2026-01-10T17:00:00Z', 'Impact Hub', '{meetup}', true),
         ('e-future', 'Future hackathon', '2027-03-10T09:00:00Z', NULL, '{hackathon}', NULL),
         ('e-synced', 'Already synced', '2027-04-01T09:00:00Z', NULL, '{talk}', NULL),
         ('e-tba', 'Talk TBA', '2027-04-02T09:00:00Z', NULL, '{talk}', NULL);
  INSERT INTO "brno_event_source_links" ("id", "eventId", "sourceName", "eventUrl")
  VALUES ('l1', 'e-past', 'GoOut', 'https://goout.example.test/past'),
         ('l2', 'e-future', 'JIC', 'https://jic.example.test/future'),
         ('l3', 'e-synced', 'JIC', 'https://jic.example.test/synced'),
         ('l4', 'e-tba', 'JIC', 'https://jic.example.test/tba');
  INSERT INTO "ProcessedItem" ("id", "watcherKind", "source", "externalId", "title", "url", "sourceType", "rawText", "metadata")
  VALUES ('n1', 'NEWS', 'NEWS_RSS_GLOBAL', 'https://news.example.test/1', 'Global story', 'https://news.example.test/1', 'NEWS', 'feed text', '{"scope":"GLOBAL","feedName":"Wire"}'),
         ('p1', 'PUBLICATIONS', 'PUBMED', '123', 'A study', 'https://pubmed.ncbi.nlm.nih.gov/123/', 'PUBLICATION', 'Abstract.', '{"query":"aging"}'),
         ('p2', 'PUBLICATIONS', 'FDA', '999', 'FDA report', 'https://api.fda.example.test/999', 'REGULATORY', 'x', '{}'),
         ('s1', 'STOCKS', 'SEC', 'acc-1', 'Filing', 'https://sec.example.test/1', 'FILING', 'x', '{}');
  INSERT INTO "Analysis" ("id", "processedItemId", "status", "result")
  VALUES ('a1', 'n1', 'SUCCESS', '{"summary":"Wire summary.","category":"ECONOMY"}'),
         ('a2', 'p1', 'SUCCESS', '{"summary":"Study summary."}');
  INSERT INTO "social_content_items" ("id", "title", "channel", "format", "draft", "finalContent", "status")
  VALUES ('c1', 'LinkedIn post', 'LINKEDIN', 'TEXT_POST', 'Draft #brno', NULL, 'DRAFT'),
         ('c2', 'Blog article', 'BLOG', 'BLOG_ARTICLE', NULL, 'Article body', 'READY'),
         ('c3', 'Idea only', 'INSTAGRAM', 'REEL', NULL, NULL, 'IDEA');
`;

describe('legacy bot content backfill migration (PostgreSQL)', () => {
  let payload: Payload;
  const db = () =>
    (
      payload.db as unknown as {
        drizzle: { execute: (q: unknown) => Promise<unknown> };
      }
    ).drizzle;
  const queuedJobs = async () =>
    (
      await payload.find({
        collection: 'payload-jobs',
        where: { taskSlug: { equals: LEGACY_BACKFILL_TASK } },
        overrideAccess: true,
        depth: 0,
      })
    ).docs as unknown as Array<{ id: string }>;
  const total = async (
    collection:
      'events' | 'news' | 'publications' | 'social-posts' | 'articles',
  ) =>
    (
      await payload.count({
        collection,
        overrideAccess: true,
      })
    ).totalDocs;

  beforeAll(async () => {
    payload = await getTestPayload();
    await db().execute(createLegacyTables);
    await db().execute(seedLegacyRows);
    // The agent already delivered this event; the backfill must not touch it.
    await new IngestionService(payload).ingestBatch(
      eventAdapter as never,
      [
        {
          externalId: 'brno-event:e-synced',
          title: 'Already synced (agent copy)',
          startsAt: '2027-04-01T09:00:00Z',
          sourceUrl: 'https://jic.example.test/synced',
          freeFood: 'yes',
          foodEvidence: [{ text: 'Free pizza' }],
        },
      ],
      { botId: 'brno-events-agent', credentialKeyId: 'k', requestId: 'r' },
    );
  }, 120_000);

  it('imports legacy rows as ingested drafts under each bot id', async () => {
    // The migration queued exactly one background job; run it like autoRun does.
    const [job, ...others] = await queuedJobs();
    expect(job).toBeDefined();
    expect(others).toHaveLength(0);
    await payload.jobs.runByID({ id: job!.id });
    // Successful jobs are deleted; a failed one would remain with hasError.
    expect(await queuedJobs()).toHaveLength(0);

    expect(await total('events')).toBe(3);
    expect(await total('news')).toBe(1);
    expect(await total('publications')).toBe(1);
    expect(await total('social-posts')).toBe(1);
    expect(await total('articles')).toBe(1);

    const events = await payload.find({
      collection: 'events',
      draft: true,
      overrideAccess: true,
      sort: 'startsAt',
      depth: 0,
    });
    expect(events.docs.map((doc) => doc.title)).toEqual([
      'Past meetup',
      'Future hackathon',
      'Already synced (agent copy)',
    ]);
    const past = events.docs[0]!;
    expect(past).toMatchObject({
      reviewStatus: 'ingested',
      _status: 'draft',
      sourceBot: 'brno-events-agent',
      externalId: 'brno-event:e-past',
      freeFood: 'unknown',
      sourceUrl: 'https://goout.example.test/past',
    });
    expect(events.docs[2]).toMatchObject({ freeFood: 'yes' });

    const news = await payload.find({
      collection: 'news',
      draft: true,
      overrideAccess: true,
      depth: 0,
    });
    expect(news.docs[0]).toMatchObject({
      sourceBot: 'news-bot',
      externalId: 'processed-item:n1',
      summary: 'Wire summary.',
      category: 'economy',
    });

    const publications = await payload.find({
      collection: 'publications',
      draft: true,
      overrideAccess: true,
      depth: 0,
    });
    expect(publications.docs[0]).toMatchObject({
      sourceBot: 'publications-bot',
      abstract: 'Abstract.',
      aiSummary: 'Study summary.',
    });
  }, 120_000);

  it('is idempotent when run again', async () => {
    await backfillLegacyBotContent(
      payload,
      async (query) =>
        ((await db().execute(query)) as { rows: Record<string, unknown>[] })
          .rows,
    );
    expect(await total('events')).toBe(3);
    expect(await total('news')).toBe(1);
    expect(await total('social-posts')).toBe(1);
    const runs = await payload.count({
      collection: 'ingestion-runs',
      overrideAccess: true,
    });
    // One agent run plus one run per non-empty collection on the first pass.
    expect(runs.totalDocs).toBe(6);
  }, 120_000);
});
