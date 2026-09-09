import { describe, expect, it } from 'vitest';
import { deduplicateStoredStockNews } from '../stock-news-store.js';

const candidate = (
  headline: string,
  publishedAt: string,
  overrides: Partial<
    Parameters<typeof deduplicateStoredStockNews>[0][number]
  > = {},
): Parameters<typeof deduplicateStoredStockNews>[0][number] => ({
  publishedAt: new Date(publishedAt),
  tickers: ['MU'],
  headline,
  summary: headline,
  description: `${headline} full stored description`,
  source: 'Reuters',
  url: `https://example.com/${encodeURIComponent(headline)}`,
  eventIds: [],
  ...overrides,
});

describe('stored stock news deduplication', () => {
  it('keeps the newest representative and removes event, URL, and title duplicates', () => {
    const articles = deduplicateStoredStockNews([
      candidate(
        'Micron announces expansion of advanced memory production capacity',
        '2026-09-08T09:00:00Z',
        { eventIds: ['event-1'] },
      ),
      candidate('Older canonical event coverage', '2026-09-08T08:00:00Z', {
        eventIds: ['event-1'],
      }),
      candidate('URL duplicate', '2026-09-08T07:00:00Z', {
        url: 'https://example.com/story?utm_source=feed',
      }),
      candidate('Same URL from another feed', '2026-09-08T06:00:00Z', {
        url: 'https://example.com/story',
      }),
      candidate(
        'Micron announces advanced memory production capacity expansion',
        '2026-09-08T05:00:00Z',
      ),
      candidate('Distinct quarterly outlook', '2026-09-08T10:00:00Z'),
    ]);

    expect(articles.map(({ headline }) => headline)).toEqual([
      'Distinct quarterly outlook',
      'Micron announces expansion of advanced memory production capacity',
      'URL duplicate',
    ]);
  });
});
