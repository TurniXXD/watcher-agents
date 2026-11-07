import { sql } from '@payloadcms/db-postgres';
import type { Payload } from 'payload';
import { z } from 'zod';
import type { IngestibleCollection } from '../collections/ingestion';
import { ingestAdapters } from './adapters';
import type {
  ArticleIngestItem,
  EventIngestItem,
  NewsIngestItem,
  PublicationIngestItem,
  SocialPostIngestItem,
} from './schemas';
import { IngestionService } from './service';

/**
 * One-time import of content that Watcher bots stored in their own (Prisma)
 * tables before the CMS existed. It runs from a Payload migration against the
 * shared Watcher database, reads those tables read-only, and submits the rows
 * through the regular ingestion service under each bot's own id, so the CMS
 * identities match what the bots send later and every record starts as an
 * `ingested` draft for editorial review. Nothing is published.
 *
 * Identities that already exist in the CMS are left untouched, so content the
 * bots delivered themselves is never overwritten and re-running is a no-op.
 */

export const LEGACY_BOT_IDS = {
  events: 'brno-events-agent',
  news: 'news-bot',
  publications: 'publications-bot',
  social: 'socials-bot',
} as const;

const BATCH_SIZE = 100;

type Input = Record<string, unknown>;
type QueryRows = (query: ReturnType<typeof sql>) => Promise<Input[]>;

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

const bounded = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/gu, ' ').trim();
  if (!trimmed) return undefined;
  return trimmed.length > max
    ? `${trimmed.slice(0, max - 1).trimEnd()}…`
    : trimmed;
};

/** Multi-line text keeps paragraph breaks but is bounded like `bounded`. */
const boundedBlock = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  if (!trimmed) return undefined;
  return trimmed.length > max
    ? `${trimmed.slice(0, max - 1).trimEnd()}…`
    : trimmed;
};

const httpUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

const isoDate = (value: unknown): Date | undefined => {
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string' || typeof value === 'number'
        ? new Date(value)
        : undefined;
  if (!date) return undefined;
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const record = (value: unknown): Input =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Input)
    : {};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];

const hostname = (url: string): string => new URL(url).hostname;

// ---------------------------------------------------------------------------
// Brno events (`brno_events` + `brno_event_source_links`)
// ---------------------------------------------------------------------------

const GENERIC_EVENT_CATEGORIES = new Set([
  'other',
  'university',
  'student',
  'social',
]);

const normalizeTitle = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();

/** Mirrors the Brno Events agent: TBA/TBD placeholders are never sent. */
export const isPlaceholderEventTitle = (value: string): boolean => {
  const normalized = normalizeTitle(value);
  return (
    /(?:^| )(?:tba|tbd)(?: |$)/u.test(normalized) ||
    normalized.includes('to be announced')
  );
};

export type LegacyBrnoEvent = {
  id: string;
  title: string;
  description: string | null;
  startAt: Date | string;
  endAt: Date | string | null;
  venueName: string | null;
  venueAddress: string | null;
  city: string | null;
  organizerName: string | null;
  categories: string[] | null;
  priceAmount: number | null;
  priceCurrency: string | null;
  priceFree: boolean | null;
  registrationRequired: boolean | null;
  registrationUrl: string | null;
  imageUrl: string | null;
  cancelled: boolean;
  lastSeenAt: Date | string;
  sourceLinks: Array<{
    sourceName: string;
    eventUrl: string;
    firstSeenAt: Date | string;
    lastSeenAt: Date | string;
  }> | null;
};

/**
 * Same item the agent's CMS outbox builds (`apps/brno-events-agent/src/cms/event-item.ts`),
 * except free food: the agent's classifier is not available here, so imported
 * events start as `unknown` (the safe default). The agent refines it when it
 * next sees an upcoming event; editors can override it at any time.
 */
export const legacyEventItem = (
  event: LegacyBrnoEvent,
): EventIngestItem | null => {
  if (isPlaceholderEventTitle(event.title)) return null;
  const startAt = isoDate(event.startAt);
  if (!startAt) return null;
  const endAt = isoDate(event.endAt);
  const links = [...(event.sourceLinks ?? [])].sort(
    (a, b) =>
      (isoDate(a.firstSeenAt)?.getTime() ?? 0) -
      (isoDate(b.firstSeenAt)?.getTime() ?? 0),
  );
  const sourceUrl = links.map((link) => httpUrl(link.eventUrl)).find(Boolean);
  if (!sourceUrl) return null;
  const categories = event.categories ?? [];
  const category =
    categories.find((entry) => !GENERIC_EVENT_CATEGORIES.has(entry)) ??
    categories[0] ??
    'other';
  const city = bounded(event.city, 120) ?? 'Brno';
  const venueName = bounded(event.venueName, 300);
  const organizerName = bounded(event.organizerName, 300);
  const label = category.replaceAll('-', ' ');
  const summaryParts = [
    `${label.charAt(0).toUpperCase()}${label.slice(1)} event in ${city}`,
  ];
  if (venueName) summaryParts.push(`at ${bounded(venueName, 120)}`);
  if (organizerName)
    summaryParts.push(`organised by ${bounded(organizerName, 120)}`);
  const sentence = `${summaryParts.join(' ')}.`;
  const isFree = event.priceFree ?? (event.priceAmount === 0 ? true : null);
  const currency =
    event.priceCurrency && /^[A-Z]{3}$/u.test(event.priceCurrency)
      ? event.priceCurrency
      : null;
  const price =
    event.priceAmount !== null &&
    event.priceAmount >= 0 &&
    (event.priceAmount === 0 || currency)
      ? event.priceAmount
      : null;
  const address = bounded(event.venueAddress, 500);
  const registrationUrl = httpUrl(event.registrationUrl);
  const sourceImageUrl = httpUrl(event.imageUrl);
  const excerpt = bounded(event.description, 600);
  const verifiedAt = isoDate(event.lastSeenAt) ?? startAt;
  return {
    externalId: `brno-event:${event.id}`,
    title: bounded(event.title, 300) ?? event.title.slice(0, 300),
    summary: event.registrationRequired
      ? `${sentence} Registration required.`
      : sentence,
    ...(excerpt ? { sourceExcerpt: excerpt } : {}),
    startsAt: startAt.toISOString(),
    ...(endAt && endAt >= startAt ? { endsAt: endAt.toISOString() } : {}),
    timezone: 'Europe/Prague',
    city,
    ...(venueName ? { venueName } : {}),
    ...(address ? { address } : {}),
    category: bounded(category, 60) ?? 'other',
    tags: [...new Set(categories.map((entry) => bounded(entry, 60)))]
      .filter((entry): entry is string => Boolean(entry))
      .slice(0, 30),
    ...(organizerName ? { organizerName } : {}),
    sourceUrl,
    ...(registrationUrl ? { registrationUrl } : {}),
    ...(sourceImageUrl ? { sourceImageUrl } : {}),
    isFree,
    price,
    currency: price && price > 0 ? currency : null,
    freeFood: 'unknown',
    foodDetails: null,
    foodEvidence: [],
    eventStatus: event.cancelled ? 'cancelled' : 'scheduled',
    verifiedAt: verifiedAt.toISOString(),
    sourceReferences: links.slice(0, 10).flatMap((link) => {
      const url = httpUrl(link.eventUrl);
      const name = bounded(link.sourceName, 200);
      const accessedAt = isoDate(link.lastSeenAt);
      return url
        ? [
            {
              title: name ?? hostname(url),
              url,
              ...(name ? { publisher: name } : {}),
              ...(accessedAt ? { accessedAt: accessedAt.toISOString() } : {}),
            },
          ]
        : [];
    }),
    aiProvenance: { generatedByAI: false, generator: LEGACY_BOT_IDS.events },
  };
};

// ---------------------------------------------------------------------------
// News and publications (`ProcessedItem` + latest successful `Analysis`)
// ---------------------------------------------------------------------------

export type LegacyProcessedItem = {
  id: string;
  source: string;
  externalId: string;
  title: string;
  url: string;
  publishedAt: Date | string | null;
  sourceType: string;
  rawText: string | null;
  metadata: unknown;
  analysis: unknown;
  analysisAt: Date | string | null;
};

const newsAnalysisSchema = z.object({
  summary: z.string().min(1),
  category: z.string().min(1).optional(),
});
const publicationAnalysisSchema = z.object({ summary: z.string().min(1) });

/** Stable external id shared by the news and publications bots. */
const processedItemExternalId = (item: LegacyProcessedItem) =>
  `processed-item:${item.id}`;

/**
 * News items carry only the bot's own LLM summary and a link to the original
 * article; the feed's text is never copied into the CMS.
 */
export const legacyNewsItem = (
  item: LegacyProcessedItem,
): NewsIngestItem | null => {
  const originalUrl = httpUrl(item.url);
  const title = bounded(item.title, 300);
  if (!originalUrl || !title) return null;
  const metadata = record(item.metadata);
  const feedName = bounded(metadata.feedName, 200);
  const scope =
    metadata.scope === 'CZECH' || metadata.scope === 'GLOBAL'
      ? metadata.scope.toLowerCase()
      : undefined;
  const analysis = newsAnalysisSchema.safeParse(item.analysis);
  const summary = analysis.success
    ? bounded(analysis.data.summary, 1500)
    : undefined;
  const publishedAt = isoDate(item.publishedAt);
  const analysedAt = isoDate(item.analysisAt);
  return {
    externalId: processedItemExternalId(item),
    title,
    ...(summary ? { summary } : {}),
    originalUrl,
    ...(feedName ? { publisher: feedName } : {}),
    ...(publishedAt ? { originalPublishedAt: publishedAt.toISOString() } : {}),
    ...(analysis.success && analysis.data.category
      ? { category: analysis.data.category.toLowerCase() }
      : {}),
    tags: scope ? [scope] : [],
    sourceReferences: [
      {
        title: feedName ?? hostname(originalUrl),
        url: originalUrl,
        ...(feedName ? { publisher: feedName } : {}),
      },
    ],
    aiProvenance: summary
      ? {
          generatedByAI: true,
          generator: LEGACY_BOT_IDS.news,
          ...(analysedAt ? { generatedAt: analysedAt.toISOString() } : {}),
          notes: 'Summary generated by the news bot before CMS integration.',
        }
      : { generatedByAI: false, generator: LEGACY_BOT_IDS.news },
  };
};

const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/u;

const publicationSourceNames: Record<string, string> = {
  PUBMED: 'PubMed',
  BIORXIV: 'bioRxiv',
};

export const legacyPublicationItem = (
  item: LegacyProcessedItem,
): PublicationIngestItem | null => {
  if (item.sourceType !== 'PUBLICATION') return null;
  const title = bounded(item.title, 500);
  const publicationUrl = httpUrl(item.url);
  if (!title) return null;
  const metadata = record(item.metadata);
  const authorsText =
    typeof metadata.authors === 'string' ? metadata.authors : '';
  const authors = authorsText.includes(';')
    ? authorsText
        .split(';')
        .map((author) => bounded(author, 200))
        .filter((author): author is string => Boolean(author))
        .slice(0, 200)
    : [];
  const doi =
    item.source === 'BIORXIV' && DOI_PATTERN.test(item.externalId)
      ? item.externalId
      : undefined;
  const publishedAt = isoDate(item.publishedAt);
  const analysis = publicationAnalysisSchema.safeParse(item.analysis);
  const aiSummary = analysis.success
    ? boundedBlock(analysis.data.summary, 3000)
    : undefined;
  const analysedAt = isoDate(item.analysisAt);
  const abstract = boundedBlock(item.rawText, 20_000);
  const journal = bounded(metadata.journal, 300);
  const topics = [
    bounded(metadata.query, 100),
    bounded(metadata.category, 100),
  ].filter((topic): topic is string => Boolean(topic));
  const publisher = publicationSourceNames[item.source];
  return {
    externalId: processedItemExternalId(item),
    title,
    authors: authors.length
      ? authors
      : stringArray(metadata.authors).slice(0, 200),
    ...(abstract ? { abstract } : {}),
    ...(aiSummary ? { aiSummary } : {}),
    ...(doi ? { doi } : {}),
    ...(journal ? { journal } : {}),
    ...(publishedAt
      ? { publicationDate: publishedAt.toISOString().slice(0, 10) }
      : {}),
    ...(publicationUrl ? { publicationUrl } : {}),
    researchTopics: [...new Set(topics)],
    sourceReferences: publicationUrl
      ? [
          {
            title: publisher ?? hostname(publicationUrl),
            url: publicationUrl,
            ...(publisher ? { publisher } : {}),
          },
        ]
      : [],
    aiProvenance: aiSummary
      ? {
          generatedByAI: true,
          generator: LEGACY_BOT_IDS.publications,
          ...(analysedAt ? { generatedAt: analysedAt.toISOString() } : {}),
          notes:
            'AI summary generated by the publications bot before CMS integration.',
        }
      : { generatedByAI: false, generator: LEGACY_BOT_IDS.publications },
  };
};

// ---------------------------------------------------------------------------
// Socials bot content (`social_content_items`)
// ---------------------------------------------------------------------------

export type LegacySocialContentItem = {
  id: string;
  title: string;
  channel: string;
  format: string;
  contentPillar: string | null;
  hook: string | null;
  draft: string | null;
  finalContent: string | null;
  publishedUrl: string | null;
  status: string;
  updatedAt: Date | string | null;
};

const socialPostFormat: Record<
  string,
  Record<string, SocialPostIngestItem['postType']>
> = {
  INSTAGRAM: {
    TEXT_POST: 'post',
    CAROUSEL: 'carousel',
    STORY: 'story',
    REEL: 'reel',
  },
  LINKEDIN: {
    TEXT_POST: 'post',
    CAROUSEL: 'carousel',
    STORY: 'post',
    REEL: 'video',
  },
};

const LONG_FORM_FORMATS = new Set(['BLOG_ARTICLE', 'NEWSLETTER_ISSUE']);
const INACTIVE_SOCIAL_STATUSES = new Set(['SKIPPED', 'ARCHIVED']);

const socialText = (item: LegacySocialContentItem) =>
  item.finalContent?.trim() ? item.finalContent : item.draft;

const socialProvenance = (item: LegacySocialContentItem) => {
  const updatedAt = isoDate(item.updatedAt);
  return item.finalContent?.trim()
    ? { generatedByAI: false, generator: LEGACY_BOT_IDS.social }
    : {
        generatedByAI: true,
        generator: LEGACY_BOT_IDS.social,
        ...(updatedAt ? { generatedAt: updatedAt.toISOString() } : {}),
        notes: 'Draft generated by the socials bot before CMS integration.',
      };
};

const hashtagsOf = (text: string): string[] =>
  [
    ...new Set(
      [...text.matchAll(/#([\p{L}\p{N}_]{1,100})/gu)].map((match) => match[1]!),
    ),
  ].slice(0, 30);

export const legacySocialPostItem = (
  item: LegacySocialContentItem,
): SocialPostIngestItem | null => {
  if (INACTIVE_SOCIAL_STATUSES.has(item.status)) return null;
  const postType = socialPostFormat[item.channel]?.[item.format];
  const content = boundedBlock(socialText(item), 5000);
  const title = bounded(item.title, 200);
  if (!postType || !content || !title) return null;
  const targetUrl = httpUrl(item.publishedUrl);
  return {
    externalId: `social-content:${item.id}`,
    title,
    content,
    platform: item.channel === 'INSTAGRAM' ? 'instagram' : 'linkedin',
    postType,
    hashtags: hashtagsOf(content),
    ...(targetUrl ? { targetUrl } : {}),
    aiProvenance: socialProvenance(item),
  };
};

export const legacyArticleItem = (
  item: LegacySocialContentItem,
): ArticleIngestItem | null => {
  if (INACTIVE_SOCIAL_STATUSES.has(item.status)) return null;
  if (item.channel !== 'BLOG' && !LONG_FORM_FORMATS.has(item.format))
    return null;
  const contentText = boundedBlock(socialText(item), 100_000);
  const title = bounded(item.title, 300);
  if (!contentText || !title) return null;
  const excerpt = bounded(item.hook, 600);
  const category = bounded(item.contentPillar, 60);
  const publishedUrl = httpUrl(item.publishedUrl);
  return {
    externalId: `social-content:${item.id}`,
    title,
    ...(excerpt ? { excerpt } : {}),
    contentText,
    categories: category ? [category] : [],
    tags: item.channel === 'NEWSLETTER' ? ['newsletter'] : [],
    sourceReferences: publishedUrl ? [{ title, url: publishedUrl }] : [],
    aiProvenance: socialProvenance(item),
  };
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export type BackfillCounts = Record<
  string,
  { candidates: number; existing: number; submitted: number; failed: number }
>;

const tableExists = async (query: QueryRows, table: string) => {
  const rows = await query(
    sql`SELECT to_regclass(${`public."${table}"`}) IS NOT NULL AS "exists"`,
  );
  return rows[0]?.exists === true;
};

const legacyQueries = {
  events: sql`
    SELECT e."id", e."title", e."description", e."startAt", e."endAt",
           e."venueName", e."venueAddress", e."city", e."organizerName",
           e."categories", e."priceAmount", e."priceCurrency", e."priceFree",
           e."registrationRequired", e."registrationUrl", e."imageUrl",
           e."cancelled", e."lastSeenAt",
           COALESCE(
             json_agg(json_build_object(
               'sourceName', l."sourceName", 'eventUrl', l."eventUrl",
               'firstSeenAt', l."firstSeenAt", 'lastSeenAt', l."lastSeenAt"
             ) ORDER BY l."firstSeenAt") FILTER (WHERE l."id" IS NOT NULL),
             '[]'::json
           ) AS "sourceLinks"
      FROM "brno_events" e
      LEFT JOIN "brno_event_source_links" l ON l."eventId" = e."id"
     GROUP BY e."id"
     ORDER BY e."startAt"`,
  processedItems: (kind: 'NEWS' | 'PUBLICATIONS') => sql`
    SELECT p."id", p."source", p."externalId", p."title", p."url",
           p."publishedAt", p."sourceType", p."rawText", p."metadata",
           a."result" AS "analysis", a."createdAt" AS "analysisAt"
      FROM "ProcessedItem" p
      LEFT JOIN LATERAL (
        SELECT "result", "createdAt" FROM "Analysis"
         WHERE "processedItemId" = p."id" AND "status" = 'SUCCESS'
         ORDER BY "createdAt" DESC
         LIMIT 1
      ) a ON TRUE
     WHERE p."watcherKind" = ${kind}::"WatcherKind"
     ORDER BY p."firstSeenAt"`,
  social: sql`
    SELECT "id", "title", "channel"::text AS "channel", "format"::text AS "format",
           "contentPillar", "hook", "draft", "finalContent", "publishedUrl",
           "status"::text AS "status", "updatedAt"
      FROM "social_content_items"
     ORDER BY "createdAt"`,
};

type Plan = {
  key: string;
  collection: IngestibleCollection;
  botId: string;
  tables: string[];
  load: (query: QueryRows) => Promise<Array<{ externalId: string } | null>>;
};

const plans: Plan[] = [
  {
    key: 'events',
    collection: 'events',
    botId: LEGACY_BOT_IDS.events,
    tables: ['brno_events', 'brno_event_source_links'],
    load: async (query) =>
      (await query(legacyQueries.events)).map((row) =>
        legacyEventItem(row as LegacyBrnoEvent),
      ),
  },
  {
    key: 'news',
    collection: 'news',
    botId: LEGACY_BOT_IDS.news,
    tables: ['ProcessedItem', 'Analysis'],
    load: async (query) =>
      (await query(legacyQueries.processedItems('NEWS'))).map((row) =>
        legacyNewsItem(row as LegacyProcessedItem),
      ),
  },
  {
    key: 'publications',
    collection: 'publications',
    botId: LEGACY_BOT_IDS.publications,
    tables: ['ProcessedItem', 'Analysis'],
    load: async (query) =>
      (await query(legacyQueries.processedItems('PUBLICATIONS'))).map((row) =>
        legacyPublicationItem(row as LegacyProcessedItem),
      ),
  },
  {
    key: 'social-posts',
    collection: 'social-posts',
    botId: LEGACY_BOT_IDS.social,
    tables: ['social_content_items'],
    load: async (query) =>
      (await query(legacyQueries.social)).map((row) =>
        legacySocialPostItem(row as LegacySocialContentItem),
      ),
  },
  {
    key: 'articles',
    collection: 'articles',
    botId: LEGACY_BOT_IDS.social,
    tables: ['social_content_items'],
    load: async (query) =>
      (await query(legacyQueries.social)).map((row) =>
        legacyArticleItem(row as LegacySocialContentItem),
      ),
  },
];

const existingIdentities = async (
  payload: Payload,
  collection: IngestibleCollection,
  botId: string,
): Promise<Set<string>> => {
  const found = await payload.find({
    collection: 'ingestion-records',
    where: {
      and: [
        { targetCollection: { equals: collection } },
        { sourceBot: { equals: botId } },
      ],
    },
    pagination: false,
    depth: 0,
    overrideAccess: true,
    select: { externalId: true },
  });
  return new Set(
    found.docs.map((doc) =>
      String((doc as { externalId?: string }).externalId),
    ),
  );
};

/**
 * Imports legacy bot content into the CMS. Missing bot tables (a standalone
 * CMS database) are skipped. Each item is written in its own transaction by
 * the ingestion service, so one bad row never blocks the rest.
 */
export const backfillLegacyBotContent = async (
  payload: Payload,
  query: QueryRows,
): Promise<BackfillCounts> => {
  const counts: BackfillCounts = {};
  const service = new IngestionService(payload);
  const runId = `legacy-backfill-${new Date().toISOString()}`;
  for (const plan of plans) {
    const present = await Promise.all(
      plan.tables.map((table) => tableExists(query, table)),
    );
    if (present.includes(false)) {
      payload.logger.info(
        { collection: plan.collection, tables: plan.tables },
        'Legacy bot tables not found; skipping content backfill',
      );
      continue;
    }
    const candidates = (await plan.load(query)).filter(
      (item): item is { externalId: string } => item !== null,
    );
    const existing = await existingIdentities(
      payload,
      plan.collection,
      plan.botId,
    );
    const missing = candidates.filter((item) => !existing.has(item.externalId));
    const tally = {
      candidates: candidates.length,
      existing: candidates.length - missing.length,
      submitted: 0,
      failed: 0,
    };
    for (let start = 0; start < missing.length; start += BATCH_SIZE) {
      const batch = missing.slice(start, start + BATCH_SIZE);
      const { run } = await service.ingestBatch(
        ingestAdapters[plan.collection],
        batch,
        {
          botId: plan.botId,
          credentialKeyId: 'migration',
          requestId: `${runId}:${plan.key}:${start / BATCH_SIZE}`,
        },
      );
      tally.submitted += batch.length;
      tally.failed += run.counts.failed;
      for (const result of run.results.filter(
        (entry) => entry.outcome === 'failed',
      )) {
        payload.logger.warn(
          {
            collection: plan.collection,
            externalId: result.externalId,
            reason: result.reason,
            details: result.details,
          },
          'Legacy content item was not imported',
        );
      }
    }
    counts[plan.key] = tally;
    payload.logger.info(
      { collection: plan.collection, botId: plan.botId, ...tally },
      'Legacy bot content backfilled',
    );
  }
  return counts;
};
