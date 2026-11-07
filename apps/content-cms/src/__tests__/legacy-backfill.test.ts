import { describe, expect, it } from 'vitest';
import {
  eventIngestItemSchema,
  articleIngestItemSchema,
  newsIngestItemSchema,
  publicationIngestItemSchema,
  socialPostIngestItemSchema,
} from '../ingestion/schemas';
import {
  legacyArticleItem,
  legacyEventItem,
  legacyNewsItem,
  legacyPublicationItem,
  legacySocialPostItem,
  type LegacyBrnoEvent,
  type LegacyProcessedItem,
  type LegacySocialContentItem,
} from '../ingestion/legacy-backfill';

const event = (overrides: Partial<LegacyBrnoEvent> = {}): LegacyBrnoEvent => ({
  id: 'evt-1',
  title: 'Hackathon Brno',
  description: 'Free pizza for all hackers. Long organiser text.',
  startAt: '2026-11-20T17:00:00.000Z',
  endAt: '2026-11-20T21:00:00.000Z',
  venueName: 'FIT VUT',
  venueAddress: 'Božetěchova 2, Brno',
  city: 'Brno',
  organizerName: 'Student Union',
  categories: ['university', 'hackathon'],
  priceAmount: 0,
  priceCurrency: null,
  priceFree: true,
  registrationRequired: true,
  registrationUrl: 'https://example.test/register',
  imageUrl: 'https://example.test/image.jpg',
  cancelled: false,
  lastSeenAt: '2026-11-07T10:00:00.000Z',
  sourceLinks: [
    {
      sourceName: 'Later source',
      eventUrl: 'https://later.example.test/e',
      firstSeenAt: '2026-11-02T00:00:00.000Z',
      lastSeenAt: '2026-11-07T00:00:00.000Z',
    },
    {
      sourceName: 'First source',
      eventUrl: 'https://first.example.test/e',
      firstSeenAt: '2026-11-01T00:00:00.000Z',
      lastSeenAt: '2026-11-07T00:00:00.000Z',
    },
  ],
  ...overrides,
});

const processed = (
  overrides: Partial<LegacyProcessedItem> = {},
): LegacyProcessedItem => ({
  id: 'pi-1',
  source: 'NEWS_RSS_CZECH',
  externalId: 'https://news.example.test/a',
  title: 'Something happened',
  url: 'https://news.example.test/a',
  publishedAt: '2026-11-05T08:00:00.000Z',
  sourceType: 'NEWS',
  rawText: 'Full feed text that must not be copied.',
  metadata: { scope: 'CZECH', feedName: 'Example News' },
  analysis: { summary: 'Bot summary.', category: 'POLITICS' },
  analysisAt: '2026-11-05T09:00:00.000Z',
  ...overrides,
});

const social = (
  overrides: Partial<LegacySocialContentItem> = {},
): LegacySocialContentItem => ({
  id: 'sc-1',
  title: 'Launch post',
  channel: 'LINKEDIN',
  format: 'TEXT_POST',
  contentPillar: 'Engineering',
  hook: 'Hook line',
  draft: 'Draft text #ai #brno',
  finalContent: null,
  publishedUrl: null,
  status: 'DRAFT',
  updatedAt: '2026-11-06T00:00:00.000Z',
  ...overrides,
});

describe('legacy bot content mapping', () => {
  it('maps a Brno event like the agent outbox, with unknown free food', () => {
    const item = legacyEventItem(event());
    expect(item).not.toBeNull();
    const parsed = eventIngestItemSchema.parse(item);
    expect(parsed).toMatchObject({
      externalId: 'brno-event:evt-1',
      sourceUrl: 'https://first.example.test/e',
      category: 'hackathon',
      summary:
        'Hackathon event in Brno at FIT VUT organised by Student Union. Registration required.',
      isFree: true,
      price: 0,
      freeFood: 'unknown',
      eventStatus: 'scheduled',
    });
    expect(parsed.sourceReferences.map((reference) => reference.url)).toEqual([
      'https://first.example.test/e',
      'https://later.example.test/e',
    ]);
  });

  it('skips placeholder events and events without a source URL', () => {
    expect(legacyEventItem(event({ title: 'Workshop TBA' }))).toBeNull();
    expect(legacyEventItem(event({ sourceLinks: [] }))).toBeNull();
    expect(legacyEventItem(event({ cancelled: true }))?.eventStatus).toBe(
      'cancelled',
    );
  });

  it('maps news with the bot summary only, never the feed text', () => {
    const parsed = newsIngestItemSchema.parse(legacyNewsItem(processed()));
    expect(parsed).toMatchObject({
      externalId: 'processed-item:pi-1',
      summary: 'Bot summary.',
      publisher: 'Example News',
      category: 'politics',
      tags: ['czech'],
      aiProvenance: { generatedByAI: true, generator: 'news-bot' },
    });
    expect(parsed.bodyText).toBeUndefined();
    const unanalysed = newsIngestItemSchema.parse(
      legacyNewsItem(processed({ analysis: null })),
    );
    expect(unanalysed.summary).toBeUndefined();
    expect(unanalysed.aiProvenance?.generatedByAI).toBe(false);
  });

  it('maps only real publications, with DOI and authors when known', () => {
    const biorxiv = publicationIngestItemSchema.parse(
      legacyPublicationItem(
        processed({
          source: 'BIORXIV',
          externalId: '10.1101/2026.11.01.123456',
          url: 'https://www.biorxiv.org/content/10.1101/2026.11.01.123456',
          sourceType: 'PUBLICATION',
          rawText: 'Abstract text.',
          metadata: { query: 'crispr', authors: 'Doe, J.; Roe, R.' },
          analysis: { summary: 'AI summary.' },
        }),
      ),
    );
    expect(biorxiv).toMatchObject({
      doi: '10.1101/2026.11.01.123456',
      authors: ['Doe, J.', 'Roe, R.'],
      abstract: 'Abstract text.',
      aiSummary: 'AI summary.',
      publicationDate: '2026-11-05',
      researchTopics: ['crispr'],
    });
    expect(
      legacyPublicationItem(processed({ sourceType: 'REGULATORY' })),
    ).toBeNull();
  });

  it('maps socials-bot items to social posts or articles', () => {
    const post = socialPostIngestItemSchema.parse(
      legacySocialPostItem(social()),
    );
    expect(post).toMatchObject({
      externalId: 'social-content:sc-1',
      platform: 'linkedin',
      postType: 'post',
      hashtags: ['ai', 'brno'],
      aiProvenance: { generatedByAI: true },
    });
    expect(legacyArticleItem(social())).toBeNull();

    const blog = social({
      channel: 'BLOG',
      format: 'BLOG_ARTICLE',
      finalContent: 'Final article',
    });
    expect(legacySocialPostItem(blog)).toBeNull();
    expect(
      articleIngestItemSchema.parse(legacyArticleItem(blog)),
    ).toMatchObject({
      contentText: 'Final article',
      excerpt: 'Hook line',
      categories: ['Engineering'],
      aiProvenance: { generatedByAI: false },
    });

    expect(legacySocialPostItem(social({ draft: null }))).toBeNull();
    expect(legacySocialPostItem(social({ status: 'ARCHIVED' }))).toBeNull();
  });
});
